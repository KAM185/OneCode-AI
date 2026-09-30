export type Rank = "LOW" | "MEDIUM" | "HIGH";

export interface ParsedMaterial {
  id: string;
  cpseId: string;
  sourceFile: string;
  rowNumber: number;
  rawDescription: string;
  ownCode: string;
  uom: string;
  quantity: number | null;
  unitPrice: number | null;

  // Stage 0 output
  category: string; // e.g. "Fastener"
  catCode: string; // e.g. "FAS"
  subtype: string; // e.g. "HNT", or "UNK" when not recognised
  attrs: Record<string, string>; // canonical attribute values
  corrosionClass: Rank | null;
  strengthRank: number | null;
  classifiedBy: "rules" | "ai";
  aiConfidence?: number;
}

export type Verdict = "duplicate" | "functionally_equivalent" | "similar" | "distinct";
export type Stage = "rule" | "lexical" | "embedding" | "ai-classify";

export interface MatchDecision {
  materialId: string;
  verdict: Verdict;
  confidence: number;
  stage: Stage;
  reasons: string[];
  safetyRisk: Rank | null;
  matchedMaterialId: string | null;
  matchedNmcCode: string | null;
  needsReview: boolean;
  auditSeq?: number;
}

export interface NmcRecord {
  nmcCode: string;
  canonicalDescription: string;
  category: string;
  subtype: string;
  complete: boolean;
  supersededBy: string | null;
  createdAt: string;
}

export type MappingStatus = "auto-issued" | "pending-review" | "reviewed-confirmed" | "reviewed-rejected";

export interface MappingEntry {
  materialId: string;
  cpseId: string;
  ownCode: string;
  description: string;
  uom: string;
  nmcCode: string;
  originalNmcCode: string;
  status: MappingStatus;
  decision: MatchDecision;
  linkedNmcCode?: string; // confirmed functional substitute (kept as separate code)
  reviewedBy?: string[];
  reviewedAt?: string;
  /** Set when `nmcCode` has since been superseded: the code to actually use
   * for migration. `nmcCode` itself is never rewritten so the audit trail of
   * what was originally issued stays intact. */
  currentNmcCode?: string;
}

/** Actual legacy material behind one side of a confirmed link (from the run that confirmed it). */
export interface LinkMember {
  cpseId: string;
  ownCode: string;
  description: string;
  nmcCode: string;
}

/** A human-validated functional substitution between two DISTINCT national
 * codes. Persisted across sessions — this is the reusable procurement asset,
 * not just a status flag on one row. Undirected: the pair is stored once,
 * with codeA < codeB lexicographically. */
export interface SubstitutionLink {
  id: string;
  codeA: string;
  codeB: string;
  verdict: Verdict;
  safetyRisk: Rank | null;
  confidence: number;
  reasons: string[];
  cpseIds: string[];
  /** Real materials on both sides, persisted so the CPSE ↔ NMC ↔ CPSE view survives reloads. */
  members?: LinkMember[];
  confirmedBy: string[];
  confirmedAt: string;
  auditSeq?: number;
}

/** Lifecycle: `oldCode` is retired in favour of `newCode`. */
export interface Supersession {
  oldCode: string;
  newCode: string;
  reason: string;
  by: string[];
  at: string;
  auditSeq?: number;
}

export interface RunStats {
  materials: number;
  skippedEmptyRows: number;
  uncategorized: number;
  aiClassified: number;
  embeddingCalls: number; // pairwise decisions resolved at the embedding stage
  embeddingsComputed: number; // unique texts actually sent to the model this run
  embeddingCacheHits: number; // lookups served from the vector cache this run
  comparisons: number; // pairwise decidePair evaluations
  auditEntriesWritten: number;
  auditError?: string;
  embedderStatus: "not-needed" | "ready" | "unavailable";
  stageCounts: Record<Stage, number>;
  parseMs: number;
  matchMs: number;
}

export interface PipelineResult {
  materials: ParsedMaterial[];
  mapping: MappingEntry[];
  records: NmcRecord[];
  runDigest: string;
  stats: RunStats;
  createdAt: string;
}

export interface SignerProof {
  id: string;
  pub: JsonWebKey;
  sig?: string;
}

export interface AuditEntry {
  seq: number;
  timestamp: string;
  action: string;
  details: Record<string, unknown>;
  prevHash: string;
  hash: string;
  signers?: SignerProof[];
}
