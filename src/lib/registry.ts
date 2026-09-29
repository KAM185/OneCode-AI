import type { LinkMember, MatchDecision, NmcRecord, PipelineResult, SubstitutionLink, Supersession } from "./types";
import { readJson, writeJson } from "./storage";

// ---------------------------------------------------------------------------
// Persistent institutional knowledge, kept separate from any single run:
//   1. Substitution reference table — human-validated "code A can stand in
//      for code B" links (built from confirmed reviews).
//   2. Supersession registry — code lifecycle ("A is retired, use B").
// Both live in localStorage (per browser, like the audit log; see README for
// the production note on central persistence).
// ---------------------------------------------------------------------------

const SUBS_KEY = "onecode_substitutions_v1";
const SUPERSEDE_KEY = "onecode_supersessions_v1";

// ----- Substitution reference table ---------------------------------------

export function linkId(codeA: string, codeB: string): string {
  const [a, b] = [codeA, codeB].sort();
  return `${a}<->${b}`;
}

export function loadSubstitutions(): SubstitutionLink[] {
  return readJson<SubstitutionLink[]>(SUBS_KEY, []);
}

export interface LinkInput {
  codeA: string;
  codeB: string;
  decision: Pick<MatchDecision, "verdict" | "safetyRisk" | "confidence" | "reasons">;
  cpseId: string;
  members?: LinkMember[];
  confirmedBy: string[];
  auditSeq?: number;
  at?: string;
}

const mergeMembers = (a: LinkMember[] = [], b: LinkMember[] = []): LinkMember[] => {
  const seen = new Map<string, LinkMember>();
  for (const m of [...a, ...b]) seen.set(`${m.cpseId}|${m.ownCode}|${m.nmcCode}`, m);
  return [...seen.values()];
};

/** Pure merge: returns a new list with the link added, or an existing link
 * enriched (more CPSEs / reviewers) — the same pair is never duplicated. */
export function mergeLink(links: SubstitutionLink[], input: LinkInput): SubstitutionLink[] {
  if (input.codeA === input.codeB) return links; // a code is not its own substitute
  const [a, b] = [input.codeA, input.codeB].sort();
  const id = linkId(a, b);
  const at = input.at ?? new Date().toISOString();
  const existing = links.find((l) => l.id === id);
  if (!existing) {
    return [
      ...links,
      {
        id,
        codeA: a,
        codeB: b,
        verdict: input.decision.verdict,
        safetyRisk: input.decision.safetyRisk,
        confidence: input.decision.confidence,
        reasons: input.decision.reasons,
        cpseIds: [...new Set([input.cpseId, ...(input.members ?? []).map((m) => m.cpseId)])],
        members: mergeMembers([], input.members),
        confirmedBy: [...new Set(input.confirmedBy)],
        confirmedAt: at,
        auditSeq: input.auditSeq,
      },
    ];
  }
  return links.map((l) =>
    l.id !== id
      ? l
      : {
          ...l,
          cpseIds: [...new Set([...l.cpseIds, input.cpseId, ...(input.members ?? []).map((m) => m.cpseId)])],
          members: mergeMembers(l.members, input.members),
          confirmedBy: [...new Set([...l.confirmedBy, ...input.confirmedBy])],
        }
  );
}

export function saveSubstitutions(links: SubstitutionLink[]): void {
  writeJson(SUBS_KEY, links);
}

// ----- Supersession registry ----------------------------------------------

export type SupersessionMap = Record<string, Supersession>;

export function loadSupersessions(): SupersessionMap {
  return readJson<SupersessionMap>(SUPERSEDE_KEY, {});
}

export function saveSupersessions(map: SupersessionMap): void {
  writeJson(SUPERSEDE_KEY, map);
}

/** Follows old -> new -> newer… to the code currently in force. Cycle-safe. */
export function resolveCurrentCode(code: string, map: SupersessionMap): string {
  const seen = new Set<string>();
  let cur = code;
  while (map[cur] && !seen.has(cur)) {
    seen.add(cur);
    cur = map[cur].newCode;
  }
  return cur;
}

export class SupersessionError extends Error {}

/** Pure: validates and returns the updated map, or throws SupersessionError. */
export function addSupersession(
  map: SupersessionMap,
  input: { oldCode: string; newCode: string; reason: string; by: string[]; auditSeq?: number; at?: string },
  knownCodes?: Set<string>
): SupersessionMap {
  const oldCode = input.oldCode.trim();
  const newCode = input.newCode.trim();
  if (!oldCode || !newCode) throw new SupersessionError("Both the retired code and its replacement are required.");
  if (oldCode === newCode) throw new SupersessionError("A code cannot supersede itself.");
  if (input.reason.trim().length < 3) throw new SupersessionError("A reason is required for the audit trail.");
  if (knownCodes && !knownCodes.has(oldCode)) throw new SupersessionError(`Unknown code: ${oldCode}`);
  if (knownCodes && !knownCodes.has(newCode)) throw new SupersessionError(`Unknown replacement code: ${newCode}`);
  if (map[oldCode]) {
    throw new SupersessionError(`${oldCode} is already superseded by ${map[oldCode].newCode}.`);
  }
  // Would the replacement's own chain lead back to the code being retired?
  if (resolveCurrentCode(newCode, map) === oldCode) {
    throw new SupersessionError(`That would create a cycle: ${newCode} already resolves back to ${oldCode}.`);
  }
  return {
    ...map,
    [oldCode]: { oldCode, newCode, reason: input.reason.trim(), by: input.by, at: input.at ?? new Date().toISOString(), auditSeq: input.auditSeq },
  };
}

/** Re-derives every `currentNmcCode` and record `supersededBy` from the
 * registry. Pure — returns a new result. */
export function applySupersessions(result: PipelineResult, map: SupersessionMap): PipelineResult {
  const mapping = result.mapping.map((e) => {
    const current = resolveCurrentCode(e.nmcCode, map);
    const { currentNmcCode: _drop, ...rest } = e;
    return current !== e.nmcCode ? { ...rest, currentNmcCode: current } : rest;
  });
  const records: NmcRecord[] = result.records.map((r) => ({ ...r, supersededBy: map[r.nmcCode]?.newCode ?? null }));
  return { ...result, mapping, records };
}
