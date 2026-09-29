import type { MatchDecision, ParsedMaterial, Rank } from "./types";
import { getSubtype, standardsEquivalent } from "./dictionary";
import { buildNmcCode, isIdentityComplete } from "./code";
import { jaccard, contentTokens, trigramCosine, numericMismatch } from "./text";
import { embedSimilarity, getEmbedderStatus } from "./embeddings";

// ---------------------------------------------------------------------------
// Stage 1 — blocking. Materials are only ever compared within the same
// category + subtype; this alone eliminates the vast majority of possible
// pairs before any scoring runs.
// ---------------------------------------------------------------------------

export function blockKey(m: ParsedMaterial): string {
  return `${m.category}|${m.subtype}`;
}

const RANK_VALUE: Record<Rank, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export function computeSafetyRisk(a: ParsedMaterial, b: ParsedMaterial, pressureBearing: boolean): Rank | null {
  if (!a.corrosionClass || !b.corrosionClass) return null;
  const diff = Math.abs(RANK_VALUE[a.corrosionClass] - RANK_VALUE[b.corrosionClass]);
  if (diff === 0) return "LOW";
  if (diff === 1) return pressureBearing ? "MEDIUM" : "LOW";
  return pressureBearing ? "HIGH" : "MEDIUM";
}

function matAttrsEqual(a: ParsedMaterial, b: ParsedMaterial, keys: string[]): { equal: boolean; onlyStandardDiffers: boolean } {
  let mismatches = 0;
  let softStandardDiff = false;
  for (const k of keys) {
    const va = a.attrs[k];
    const vb = b.attrs[k];
    if ((va ?? null) === (vb ?? null)) continue;
    if (k === "standard" && standardsEquivalent(va, vb)) {
      // Dimensionally interchangeable, but NOT the same as an exact match —
      // must still route to review, never silently collapse to "duplicate".
      softStandardDiff = true;
      continue;
    }
    mismatches++;
  }
  return { equal: mismatches === 0 && !softStandardDiff, onlyStandardDiffers: mismatches === 0 && softStandardDiff };
}

export async function textSimilarity(a: string, b: string): Promise<{ score: number; via: "embedding" | "lexical" }> {
  if (getEmbedderStatus() !== "unavailable") {
    const sim = await embedSimilarity(a, b);
    if (sim !== null) return { score: sim, via: "embedding" };
  }
  // Fallback: blend of token-Jaccard and character-trigram cosine — robust
  // to reordering and minor typos without needing the model.
  const lex = jaccard(contentTokens(a), contentTokens(b));
  const tri = trigramCosine(a, b);
  return { score: 0.5 * lex + 0.5 * tri, via: "lexical" };
}

// ---------------------------------------------------------------------------
// Stage 2-4 — decide whether two materials in the same block are the same,
// interchangeable, related, or unrelated.
// ---------------------------------------------------------------------------

export async function decidePair(a: ParsedMaterial, b: ParsedMaterial): Promise<MatchDecision> {
  const codeA = buildNmcCode(a);
  const codeB = buildNmcCode(b);
  const base = { materialId: a.id, matchedMaterialId: b.id, matchedNmcCode: codeB };

  // Exact identity match (only possible when both are complete, dictionary-
  // resolved records — see code.ts for why incomplete records never share
  // a bare code with each other).
  if (codeA === codeB && isIdentityComplete(a) && isIdentityComplete(b)) {
    return {
      ...base,
      verdict: "duplicate",
      confidence: 1,
      stage: "rule",
      reasons: ["Identical canonical attributes"],
      safetyRisk: "LOW",
      needsReview: false,
    };
  }

  const def = getSubtype(a.subtype);

  if (def && isIdentityComplete(a) && isIdentityComplete(b)) {
    // Both fully resolved by the dictionary. Dimensional attributes must
    // match for any equivalence to even be considered — two different
    // sizes/ratings are never auto- or human-merged as "the same material".
    const dimMismatch = def.dimAttrs.some((k) => (a.attrs[k] ?? null) !== (b.attrs[k] ?? null));
    if (dimMismatch) {
      return {
        ...base,
        verdict: "distinct",
        confidence: 0.9,
        stage: "rule",
        reasons: [`Different ${def.dimAttrs.join("/")} — not interchangeable regardless of material grade`],
        safetyRisk: null,
        needsReview: false,
      };
    }

    const { equal: matEqual, onlyStandardDiffers } = matAttrsEqual(a, b, def.matAttrs);
    const safetyRisk = computeSafetyRisk(a, b, def.pressureBearing);
    const sameFunction = a.corrosionClass !== null && a.corrosionClass === b.corrosionClass;

    if (onlyStandardDiffers) {
      // Everything material-relevant matches except a standard/spec number
      // that we know is dimensionally equivalent (e.g. DIN934 vs ISO4032) —
      // still not silently auto-merged, but a clearly low-effort review.
      return {
        ...base,
        verdict: "similar",
        confidence: 0.85,
        stage: "rule",
        reasons: [`Same dimensions and material; standards ${a.attrs.standard} / ${b.attrs.standard} are dimensionally equivalent`],
        safetyRisk,
        needsReview: true,
      };
    }

    if (matEqual) {
      return {
        ...base,
        verdict: "duplicate",
        confidence: 1,
        stage: "rule",
        reasons: ["Identical canonical attributes"],
        safetyRisk: "LOW",
        needsReview: false,
      };
    }

    if (sameFunction) {
      return {
        ...base,
        verdict: "functionally_equivalent",
        confidence: 0.75,
        stage: "rule",
        reasons: [`Same ${def.dimAttrs.join("/")}, matching corrosion class (${a.corrosionClass}) despite differing grade (${a.attrs.grade ?? "?"} vs ${b.attrs.grade ?? "?"})`],
        safetyRisk,
        needsReview: true,
      };
    }

    // Same dimensions, differing material properties, not a known-equal
    // function class. A non-LOW safety risk means this is a live
    // substitution question REGARDLESS of how the wording happens to
    // compare — the Safety Score, not text similarity, is the deciding
    // signal here. Text similarity only decides the outcome when there is
    // no safety concern at all (safetyRisk is LOW or not applicable).
    if (safetyRisk === "HIGH" || safetyRisk === "MEDIUM") {
      return {
        ...base,
        verdict: "similar",
        confidence: 0.6,
        stage: "rule",
        reasons: [`Same dimensions, differing grade (${a.attrs.grade ?? "?"} vs ${b.attrs.grade ?? "?"}) with a ${safetyRisk.toLowerCase()}-risk corrosion-class change on a ${def.pressureBearing ? "pressure-bearing" : ""} part`.trim()],
        safetyRisk,
        needsReview: true,
      };
    }

    const sim = await textSimilarity(a.rawDescription, b.rawDescription);
    if (sim.score > 0.7) {
      return {
        ...base,
        verdict: "similar",
        confidence: sim.score,
        stage: sim.via === "embedding" ? "embedding" : "lexical",
        reasons: [`Same dimensions, differing material attributes; description similarity ${(sim.score * 100).toFixed(0)}%`],
        safetyRisk,
        needsReview: true,
      };
    }
    return {
      ...base,
      verdict: "distinct",
      confidence: 1 - sim.score,
      stage: sim.via === "embedding" ? "embedding" : "lexical",
      reasons: ["Same dimensions but materially and descriptively distinct"],
      safetyRisk,
      needsReview: false,
    };
  }

  // At least one side is unrecognized/incomplete — no structured attributes
  // to lean on, so decide purely from description similarity. This is the
  // path the old build got wrong (it silently merged everything here);
  // now it always needs review unless the wording is near-identical.
  const numMismatch = numericMismatch(contentTokens(a.rawDescription), contentTokens(b.rawDescription));
  const sim = await textSimilarity(a.rawDescription, b.rawDescription);

  if (numMismatch) {
    return {
      ...base,
      verdict: "distinct",
      confidence: 0.7,
      stage: sim.via === "embedding" ? "embedding" : "lexical",
      reasons: ["Numeric values in the descriptions disagree (likely different size/rating)"],
      safetyRisk: null,
      needsReview: false,
    };
  }
  if (sim.score > 0.9) {
    return {
      ...base,
      verdict: "duplicate",
      confidence: sim.score,
      stage: sim.via === "embedding" ? "embedding" : "lexical",
      reasons: ["Unrecognized item type, but wording is near-identical"],
      safetyRisk: "MEDIUM",
      needsReview: true,
    };
  }
  if (sim.score > 0.6) {
    return {
      ...base,
      verdict: "similar",
      confidence: sim.score,
      stage: sim.via === "embedding" ? "embedding" : "lexical",
      reasons: ["Unrecognized item type; description wording is substantially similar"],
      safetyRisk: "MEDIUM",
      needsReview: true,
    };
  }
  return {
    ...base,
    verdict: "distinct",
    confidence: 1 - sim.score,
    stage: sim.via === "embedding" ? "embedding" : "lexical",
    reasons: ["No meaningful overlap"],
    safetyRisk: null,
    needsReview: false,
  };
}

// ---------------------------------------------------------------------------
// Multi-way matching. A material is compared against EVERY plausible
// candidate and keeps the strongest match, instead of settling for the first
// non-distinct one it meets (which could pick "similar" against item #2 when
// item #5 was an exact duplicate).
// ---------------------------------------------------------------------------

const VERDICT_STRENGTH: Record<MatchDecision["verdict"], number> = {
  duplicate: 3,
  functionally_equivalent: 2,
  similar: 1,
  distinct: 0,
};
const RISK_ORDER: Record<Rank, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/** Strictly-better ordering: stronger verdict, then higher confidence, then
 * lower safety risk. Exact ties keep the incumbent (earlier candidate) so
 * results are deterministic for a given input order. */
export function isBetterDecision(candidate: MatchDecision, incumbent: MatchDecision | null): boolean {
  if (!incumbent) return true;
  const ds = VERDICT_STRENGTH[candidate.verdict] - VERDICT_STRENGTH[incumbent.verdict];
  if (ds !== 0) return ds > 0;
  if (candidate.confidence !== incumbent.confidence) return candidate.confidence > incumbent.confidence;
  const rc = candidate.safetyRisk ? RISK_ORDER[candidate.safetyRisk] : 0;
  const ri = incumbent.safetyRisk ? RISK_ORDER[incumbent.safetyRisk] : 0;
  return rc < ri;
}

/** Dimensional identity of a fully-resolved material (e.g. "M12" for a hex
 * nut). Two complete materials with different dim keys are ALWAYS distinct
 * (decidePair's dimension gate), so they never need comparing — this lets
 * the pipeline skip them without changing any result. Returns null for
 * incomplete/unrecognised materials, which must be compared against
 * everything in their block. */
export function dimKey(m: ParsedMaterial): string | null {
  if (!isIdentityComplete(m)) return null;
  const def = getSubtype(m.subtype);
  if (!def) return null;
  return def.dimAttrs.map((k) => m.attrs[k]).join("|");
}

export interface MatchCandidate<T> {
  material: ParsedMaterial;
  payload: T;
}

export interface BestMatch<T> {
  decision: MatchDecision | null;
  candidate: MatchCandidate<T> | null;
  comparisons: number;
  /** Non-distinct candidates seen in total (>= 1 when decision is non-null). */
  nonDistinct: number;
  embeddingDecisions: number;
}

/**
 * Compare `m` against all candidates and return the strongest non-distinct
 * decision. The only early exit is a perfect, review-free exact duplicate —
 * nothing can outrank it, so stopping there is provably lossless.
 */
export async function findBestMatch<T>(
  m: ParsedMaterial,
  candidates: Iterable<MatchCandidate<T>>,
  decide: (a: ParsedMaterial, b: ParsedMaterial) => Promise<MatchDecision> = decidePair
): Promise<BestMatch<T>> {
  let best: MatchDecision | null = null;
  let bestCandidate: MatchCandidate<T> | null = null;
  let comparisons = 0;
  let nonDistinct = 0;
  let embeddingDecisions = 0;

  for (const c of candidates) {
    const d = await decide(m, c.material);
    comparisons++;
    if (d.stage === "embedding") embeddingDecisions++;
    if (d.verdict === "distinct") continue;
    nonDistinct++;
    if (isBetterDecision(d, best)) {
      best = d;
      bestCandidate = c;
    }
    if (d.verdict === "duplicate" && d.confidence === 1 && !d.needsReview) break;
  }
  return { decision: best, candidate: bestCandidate, comparisons, nonDistinct, embeddingDecisions };
}
