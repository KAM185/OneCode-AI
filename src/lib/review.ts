import type { LinkInput } from "./registry";
import { resolveCurrentCode, type SupersessionMap } from "./registry";
import { buildNmcCode, toNmcRecord } from "./code";
import type { MappingEntry, PipelineResult } from "./types";

export type ReviewOutcome = "confirmed" | "rejected";

/** Which national code a confirmed (non-merge) review links this row to. */
export function linkTargetFor(entry: MappingEntry): string | null {
  if (entry.decision.verdict === "duplicate" || entry.decision.verdict === "distinct") return null;
  const target = entry.decision.matchedNmcCode;
  return target && target !== entry.nmcCode ? target : null;
}

export interface ReviewApplication {
  result: PipelineResult;
  /** Present when the review produced a validated-substitute link to persist. */
  link: LinkInput | null;
}

/**
 * Pure state transition for a resolved review item.
 *
 *  - confirm a merge (duplicate):      code stays merged.
 *  - confirm an equivalence/similar:   the row KEEPS its own code and records
 *                                      linkedNmcCode = the code it was validated
 *                                      as a substitute for, and a link is
 *                                      returned for the persistent table.
 *  - reject a merge (duplicate):       the row is un-merged — it reverts to its
 *                                      own code (originalNmcCode is preserved).
 *                                      Previously the status flipped but the
 *                                      merged code silently stayed.
 *  - reject anything else:             status only (nothing was linked).
 */
export function applyReview(
  result: PipelineResult,
  entry: MappingEntry,
  outcome: ReviewOutcome,
  reviewers: string[],
  supersessions: SupersessionMap,
  auditSeq?: number,
  now: string = new Date().toISOString()
): ReviewApplication {
  const idx = result.mapping.findIndex((m) => m.materialId === entry.materialId);
  if (idx < 0 || result.mapping[idx].status !== "pending-review") return { result, link: null };

  const current = result.mapping[idx];
  const updated: MappingEntry = {
    ...current,
    status: outcome === "confirmed" ? "reviewed-confirmed" : "reviewed-rejected",
    reviewedBy: reviewers,
    reviewedAt: now,
  };
  let link: LinkInput | null = null;
  let records = result.records;

  if (outcome === "confirmed") {
    const target = linkTargetFor(current);
    if (target) {
      updated.linkedNmcCode = target;
      const other = result.mapping.find((m) => m.materialId === current.decision.matchedMaterialId);
      const members = [
        { cpseId: current.cpseId, ownCode: current.ownCode, description: current.description, nmcCode: current.nmcCode },
        ...(other ? [{ cpseId: other.cpseId, ownCode: other.ownCode, description: other.description, nmcCode: other.nmcCode }] : []),
      ];
      link = {
        members,
        codeA: current.nmcCode,
        codeB: target,
        decision: current.decision,
        cpseId: current.cpseId,
        confirmedBy: reviewers,
        auditSeq,
        at: now,
      };
    }
  } else if (current.decision.verdict === "duplicate") {
    const material = result.materials.find((m) => m.id === current.materialId);
    if (material) {
      const ownCode = buildNmcCode(material);
      if (ownCode !== current.nmcCode) {
        updated.nmcCode = ownCode;
        if (!records.some((r) => r.nmcCode === ownCode)) records = [...records, toNmcRecord(material)];
      }
    }
  }

  const resolved = resolveCurrentCode(updated.nmcCode, supersessions);
  if (resolved !== updated.nmcCode) updated.currentNmcCode = resolved;
  else delete updated.currentNmcCode;

  const mapping = result.mapping.slice();
  mapping[idx] = updated;
  return { result: { ...result, mapping, records }, link };
}
