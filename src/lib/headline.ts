import type { PipelineResult } from "./types";

export interface Headline {
  items: number;
  codes: number;
  cpses: number;
  reductionPct: number;
  autoResolvedPct: number;
  pendingReview: number;
  highRisk: number;
}

/** Every figure is counted from the run itself — nothing is estimated. */
export function headlineStats(r: PipelineResult): Headline {
  const items = r.mapping.length;
  const codes = new Set(r.mapping.map((m) => m.currentNmcCode ?? m.nmcCode)).size;
  const cpses = new Set(r.mapping.map((m) => m.cpseId)).size;
  const pendingReview = r.mapping.filter((m) => m.status === "pending-review").length;
  const highRisk = r.mapping.filter((m) => m.decision.safetyRisk === "HIGH").length;
  return {
    items,
    codes,
    cpses,
    reductionPct: items === 0 ? 0 : Math.round((1 - codes / items) * 100),
    autoResolvedPct: items === 0 ? 0 : Math.round(((items - pendingReview) / items) * 100),
    pendingReview,
    highRisk,
  };
}
