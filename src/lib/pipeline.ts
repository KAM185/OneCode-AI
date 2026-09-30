import type { MappingEntry, MatchDecision, ParsedMaterial, PipelineResult, RunStats, Stage } from "./types";
import { parseCpseFile, ParseError } from "./parse";
import { blockKey, dimKey, findBestMatch, type MatchCandidate } from "./match";
import { buildNmcCode, toNmcRecord } from "./code";
import { extractAttributes, subtypePrototypes } from "./dictionary";
import { classifyBySimilarity, getEmbedderStatus, getEmbeddingStats, prefetchEmbeddings, warmupEmbedder } from "./embeddings";
import { appendAuditBatch, loadAuditLog, computeRunDigestSync, type AuditItem } from "./audit";
import { applySupersessions, loadSupersessions, type SupersessionMap } from "./registry";
import { isIdentityComplete } from "./code";

export interface CpseUpload {
  file: File;
  cpseId: string;
}

export interface PipelineOptions {
  /** Code-lifecycle registry to apply; defaults to the persisted one. */
  supersessions?: SupersessionMap;
}

interface Settled {
  nmcCode: string;
}

const PROTOTYPES = subtypePrototypes();

/**
 * Stage 0 (AI fallback) — for any row the rule-based dictionary could not
 * classify at all, ask the local embedding model which known category it
 * most resembles. This is a real, additional use of AI beyond Stage 3
 * matching: it generalizes the (necessarily finite) dictionary to wording
 * the curators never anticipated, rather than leaving every unfamiliar
 * phrasing permanently "Uncategorized". If the model is unavailable, this
 * step is skipped cleanly — rows simply stay rule-based/Uncategorized,
 * which the pipeline already handles safely (see code.ts).
 */
async function aiAssistedReclassification(materials: ParsedMaterial[]): Promise<number> {
  if (getEmbedderStatus() === "unavailable") return 0;
  const unknown = materials.filter((m) => m.subtype === "UNK");
  if (unknown.length === 0) return 0;
  // One batched pass embeds every unknown description (and, via the cache,
  // the subtype prototypes exactly once) instead of one model call per row.
  if (!(await prefetchEmbeddings([...PROTOTYPES.map((p) => p.text), ...unknown.map((m) => m.rawDescription)]))) return 0;
  let reclassified = 0;
  for (const m of unknown) {
    if (m.subtype !== "UNK") continue;
    const guess = await classifyBySimilarity(m.rawDescription, PROTOTYPES);
    if (!guess) continue;
    const ex = extractAttributes(m.rawDescription, guess.code);
    m.category = ex.category;
    m.catCode = ex.catCode;
    m.subtype = ex.subtype;
    m.attrs = ex.attrs;
    m.corrosionClass = ex.corrosionClass;
    m.strengthRank = ex.strengthRank;
    m.classifiedBy = "ai";
    m.aiConfidence = guess.score;
    reclassified++;
  }
  return reclassified;
}

export async function runPipeline(
  uploads: CpseUpload[],
  onProgress?: (message: string) => void,
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  warmupEmbedder(); // fire the model load in the background immediately
  const embedStart = getEmbeddingStats();
  const supersessions = options.supersessions ?? loadSupersessions();

  const t0 = performance.now();
  onProgress?.("Parsing files…");
  let skippedEmptyRows = 0;
  const materials: ParsedMaterial[] = [];
  for (const u of uploads) {
    const { materials: m, skippedEmptyRows: s } = await parseCpseFile(u.file, u.cpseId);
    materials.push(...m);
    skippedEmptyRows += s;
  }

  if (materials.length === 0) throw new ParseError("No valid material rows found — every row was empty or had no description.");

  onProgress?.("Classifying unrecognized items with local AI…");
  const aiClassified = await aiAssistedReclassification(materials);
  const parseMs = performance.now() - t0;

  onProgress?.("Matching materials…");
  const t1 = performance.now();

  const blocks = new Map<string, ParsedMaterial[]>();
  for (const m of materials) {
    const key = blockKey(m);
    (blocks.get(key) ?? blocks.set(key, []).get(key)!).push(m);
  }

  // Batch-embed, once, every description that is certain (or likely) to need
  // a text comparison: incomplete identities in multi-member blocks, plus
  // complete identities that share a dimension key with a different code.
  // Everything else is embedded lazily and cached, so nothing is ever
  // embedded twice.
  const toPrefetch: string[] = [];
  for (const bucket of blocks.values()) {
    if (bucket.length < 2) continue;
    const dimGroups = new Map<string, Set<string>>();
    for (const m of bucket) {
      const dk = dimKey(m);
      if (dk === null) toPrefetch.push(m.rawDescription);
      else (dimGroups.get(dk) ?? dimGroups.set(dk, new Set()).get(dk)!).add(buildNmcCode(m));
    }
    for (const m of bucket) {
      const dk = dimKey(m);
      if (dk !== null && (dimGroups.get(dk)?.size ?? 0) > 1) toPrefetch.push(m.rawDescription);
    }
  }
  if (toPrefetch.length > 0) {
    onProgress?.("Embedding descriptions once…");
    await prefetchEmbeddings(toPrefetch);
  }

  const mapping: MappingEntry[] = [];
  const auditItems: AuditItem[] = [];
  const stageCounts: Record<Stage, number> = { rule: 0, lexical: 0, embedding: 0, "ai-classify": 0 };
  let embeddingCalls = 0;
  let comparisons = 0;

  for (const bucket of blocks.values()) {
    // Candidate pools for this block. Complete identities are indexed by
    // dimension key and then by NMC code: two complete materials with the same
    // code have identical decision-relevant attributes, so one representative
    // per code is enough. Incomplete identities are compared against
    // everything (they have no structured attributes to rule anything out).
    const completeByDim = new Map<string, Map<string, MatchCandidate<Settled>>>();
    const completeAll: MatchCandidate<Settled>[] = [];
    const incomplete: MatchCandidate<Settled>[] = [];

    for (const m of bucket) {
      const ownCode = buildNmcCode(m);
      const dk = dimKey(m);

      const pool: Iterable<MatchCandidate<Settled>> =
        dk !== null ? [...(completeByDim.get(dk)?.values() ?? []), ...incomplete] : [...completeAll, ...incomplete];

      const best = await findBestMatch<Settled>(m, pool);
      comparisons += best.comparisons;
      embeddingCalls += best.embeddingDecisions;

      let decision: MatchDecision | null = best.decision;
      let matchedCode: string | null = null;
      if (decision && best.candidate) {
        matchedCode = best.candidate.payload.nmcCode;
        // The code actually in force for the matched material — which may be
        // a merged code — not a recomputation from its own attributes.
        decision = { ...decision, matchedNmcCode: matchedCode };
        if (best.nonDistinct > 1) {
          decision = { ...decision, reasons: [...decision.reasons, `Best of ${best.nonDistinct} comparable candidates in block`] };
        }
      }

      const nmcCode = decision && decision.verdict === "duplicate" && matchedCode ? matchedCode : ownCode;

      if (!decision) {
        decision = {
          materialId: m.id,
          matchedMaterialId: null,
          matchedNmcCode: null,
          verdict: "distinct",
          confidence: 1,
          stage: "rule",
          reasons: ["No match found in block"],
          safetyRisk: null,
          needsReview: false,
        };
      }
      stageCounts[decision.stage]++;

      const cand: MatchCandidate<Settled> = { material: m, payload: { nmcCode } };
      if (dk !== null && isIdentityComplete(m)) {
        const byCode = completeByDim.get(dk) ?? completeByDim.set(dk, new Map()).get(dk)!;
        if (!byCode.has(nmcCode)) {
          byCode.set(nmcCode, cand);
          completeAll.push(cand);
        }
      } else {
        incomplete.push(cand);
      }

      const status: MappingEntry["status"] = decision.needsReview ? "pending-review" : "auto-issued";
      mapping.push({
        materialId: m.id,
        cpseId: m.cpseId,
        ownCode: m.ownCode,
        description: m.rawDescription,
        uom: m.uom,
        nmcCode,
        originalNmcCode: nmcCode,
        status,
        decision,
      });

      auditItems.push({
        action: `code_issued_${decision.verdict}`,
        details: {
          materialId: m.id,
          cpseId: m.cpseId,
          ownCode: m.ownCode,
          nmcCode,
          verdict: decision.verdict,
          confidence: Number(decision.confidence.toFixed(3)),
          stage: decision.stage,
          safetyRisk: decision.safetyRisk,
          reasons: decision.reasons,
        },
      });
    }
  }

  // One atomic write for the whole run. (Previously one un-awaited write per
  // row raced against itself and kept only one entry — see audit.ts.)
  let auditEntriesWritten = 0;
  let auditError: string | undefined;
  try {
    auditEntriesWritten = (await appendAuditBatch(auditItems)).length;
  } catch (err) {
    auditError = err instanceof Error ? err.message : String(err);
  }

  const matchMs = performance.now() - t1;
  const entryByMaterial = new Map(mapping.map((e) => [e.materialId, e]));
  const nmcByCode = new Map<string, ReturnType<typeof toNmcRecord>>();
  for (const m of materials) {
    const code = entryByMaterial.get(m.id)?.nmcCode ?? buildNmcCode(m);
    if (!nmcByCode.has(code)) nmcByCode.set(code, toNmcRecord(m));
  }

  const embedEnd = getEmbeddingStats();
  const embeddingsComputed = embedEnd.modelTextsEmbedded - embedStart.modelTextsEmbedded;
  const stats: RunStats = {
    materials: materials.length,
    skippedEmptyRows,
    uncategorized: materials.filter((m) => m.subtype === "UNK").length,
    aiClassified,
    embeddingCalls,
    embeddingsComputed,
    embeddingCacheHits: embedEnd.cacheHits - embedStart.cacheHits,
    comparisons,
    auditEntriesWritten,
    auditError,
    // Report what actually happened, not what was hoped for.
    embedderStatus: getEmbedderStatus() === "unavailable" ? "unavailable" : embeddingsComputed > 0 || embedEnd.cacheSize > 0 ? "ready" : "not-needed",
    stageCounts,
    parseMs: Math.round(parseMs),
    matchMs: Math.round(matchMs),
  };

  const runDigest = computeRunDigestSync(loadAuditLog());

  return applySupersessions(
    {
      materials,
      mapping,
      records: [...nmcByCode.values()],
      runDigest,
      stats,
      createdAt: new Date().toISOString(),
    },
    supersessions
  );
}
