import type { MappingEntry, ParsedMaterial, Rank } from "./types";
import { getSubtype, standardsEquivalent } from "./dictionary";
import { computeSafetyRisk, textSimilarity } from "./match";

export type Status = "same" | "compatible" | "different" | "unknown";
export type Outcome = "AUTO ISSUE" | "HUMAN REVIEW" | "REJECT";

export interface AttrEvidence {
  key: string;
  label: string;
  a?: string;
  b?: string;
  status: Status;
  /** How this attribute influenced the decision (from the real rule). */
  role: string;
}
export interface Check { label: string; status: Status; detail: string }
export interface Score { label: string; value: number | null; note?: string }

export interface Explanation {
  outcome: Outcome;
  checks: Check[];
  attrs: AttrEvidence[];
  safety: Check[];
  reasoning: string;
  outcomeWhy: string;
  scores: Score[];
}

const LABELS: Record<string, string> = { grade: "Material grade", standard: "Standard", thread: "Thread", size: "Size", dn: "Nominal size", rating: "Rating", schedule: "Schedule" };
const label = (k: string) => LABELS[k] ?? k.charAt(0).toUpperCase() + k.slice(1);

export function outcomeOf(e: MappingEntry): Outcome {
  if (e.decision.verdict === "distinct") return "REJECT";
  return e.decision.needsReview ? "HUMAN REVIEW" : "AUTO ISSUE";
}

/** Everything except the (async) description similarity — pure and cheap. */
export function explain(entry: MappingEntry, a: ParsedMaterial, b: ParsedMaterial, sim: { score: number; via: string } | null): Explanation {
  const d = entry.decision;
  const def = getSubtype(a.subtype);
  const outcome = outcomeOf(entry);
  const dimKeys = def?.dimAttrs ?? [];
  const matKeys = def?.matAttrs ?? [];

  const attrs: AttrEvidence[] = [];
  const cmp = (k: string, dim: boolean): AttrEvidence => {
    const va = a.attrs[k], vb = b.attrs[k];
    let status: Status = va === undefined && vb === undefined ? "unknown" : va === vb ? "same" : "different";
    if (k === "standard" && status === "different" && standardsEquivalent(va, vb)) status = "compatible";
    return { key: k, label: label(k), a: va, b: vb, status,
      role: dim ? "Dimensional attribute — a mismatch makes the items distinct" : k === "standard" ? "Standard — equivalent standards route to review, never auto-merge" : "Material attribute — a mismatch triggers similar/functional-equivalence review" };
  };
  attrs.push({ key: "category", label: "Category", a: a.category, b: b.category, status: a.category === b.category ? "same" : "different", role: "Blocking key — only same category/subtype pairs are compared" });
  attrs.push({ key: "subtype", label: "Subtype", a: a.subtype, b: b.subtype, status: a.subtype === b.subtype ? "same" : "different", role: "Blocking key — only same category/subtype pairs are compared" });
  for (const k of [...dimKeys, ...matKeys]) attrs.push(cmp(k, dimKeys.includes(k)));
  const dimAttrs = attrs.filter((x) => dimKeys.includes(x.key));
  const structured = attrs.filter((x) => x.key !== "category" && x.key !== "subtype");
  const dimOk = dimAttrs.length > 0 && dimAttrs.every((x) => x.status === "same");
  if (dimAttrs.length) attrs.push({ key: "dimensions", label: "Dimensions", a: dimAttrs.map((x) => x.a ?? "?").join(" / "), b: dimAttrs.map((x) => x.b ?? "?").join(" / "), status: dimOk ? "compatible" : "different", role: "Aggregate of dimensional attributes" });
  if (sim) attrs.push({ key: "desc", label: "Description similarity", a: undefined, b: undefined, status: sim.score >= 0.85 ? "same" : sim.score >= 0.6 ? "compatible" : "different", role: `${(sim.score * 100).toFixed(0)}% via ${sim.via}` });

  // Safety — existing engine (computeSafetyRisk) + existing rule gates only.
  const risk: Rank | null = def ? computeSafetyRisk(a, b, def.pressureBearing) : d.safetyRisk;
  const grade = attrs.find((x) => x.key === "grade");
  const std = attrs.find((x) => x.key === "standard");
  const safety: Check[] = [
    { label: "Dimensional compatibility", status: dimAttrs.length ? (dimOk ? "compatible" : "different") : "unknown", detail: dimAttrs.length ? (dimOk ? "All dimensional attributes match" : "Dimensional attributes differ") : "No structured dimensions (unrecognised item type)" },
    { label: "Grade compatibility", status: grade ? grade.status : "unknown", detail: grade ? `${grade.a ?? "?"} vs ${grade.b ?? "?"}` : "Not applicable to this subtype" },
    { label: "Corrosion / material risk", status: !a.corrosionClass || !b.corrosionClass ? "unknown" : a.corrosionClass === b.corrosionClass ? "same" : "different", detail: a.corrosionClass && b.corrosionClass ? `Corrosion class ${a.corrosionClass} vs ${b.corrosionClass}${def?.pressureBearing ? " on a pressure-bearing part" : ""} → risk ${risk ?? "n/a"}` : "Corrosion class not available for one or both items" },
    { label: "Standard compatibility", status: std ? std.status : "unknown", detail: std ? `${std.a ?? "?"} vs ${std.b ?? "?"}${std.status === "compatible" ? " (listed as dimensionally equivalent)" : ""}` : "Not applicable to this subtype" },
    { label: "Recorded safety risk", status: d.safetyRisk === "LOW" ? "same" : d.safetyRisk ? "different" : "unknown", detail: d.safetyRisk ? `${d.safetyRisk}${d.safetyRisk === "HIGH" ? " — confirmation requires a second reviewer" : ""}` : "Not calculated" },
  ];

  const checks: Check[] = structured.map((x) => ({ label: x.label, status: x.status, detail: `${x.a ?? "—"} vs ${x.b ?? "—"}` }));
  if (!structured.length) checks.push({ label: "Structured attributes", status: "unknown", detail: "Unrecognised item type — decided from description text only" });

  // Score breakdown — only real, derived values; otherwise null.
  const eq = structured.filter((x) => x.status === "same").length;
  const scores: Score[] = [
    { label: "Semantic similarity", value: sim ? sim.score : null, note: sim ? sim.via : undefined },
    { label: "Attribute match", value: structured.length ? eq / structured.length : null },
    { label: "Dimensional compatibility", value: dimAttrs.length ? dimAttrs.filter((x) => x.status === "same").length / dimAttrs.length : null },
    { label: "Material compatibility", value: null, note: a.corrosionClass && b.corrosionClass ? `corrosion class ${a.corrosionClass} vs ${b.corrosionClass}` : undefined },
    { label: "Standard compatibility", value: std ? (std.status === "same" ? 1 : null) : null, note: std && std.status !== "same" ? (std.status === "compatible" ? "equivalent standards (no numeric score)" : "standards differ") : undefined },
    { label: "Overall decision confidence", value: d.confidence, note: `stage: ${d.stage}` },
  ];

  const diffs = structured.filter((x) => x.status === "different" || x.status === "compatible");
  const sames = structured.filter((x) => x.status === "same");
  const item = a.subtype !== "UNK" ? (def?.label ?? a.subtype).toLowerCase() : "item";
  const sameTxt = sames.length ? `Both records describe a ${item} with matching ${sames.map((x) => `${x.label.toLowerCase()} (${x.a})`).join(", ")}.` : `The records are both classified as ${item} but no structured attributes could be compared.`;
  const diffTxt = diffs.length ? ` Differences: ${diffs.map((x) => `${x.label.toLowerCase()} ${x.a ?? "?"} vs ${x.b ?? "?"}${x.status === "compatible" ? " (equivalent)" : ""}`).join("; ")}.` : " No attribute differences were found.";
  const simTxt = sim ? ` Description similarity is ${(sim.score * 100).toFixed(0)}% (${sim.via}).` : "";
  const outTxt = outcome === "HUMAN REVIEW" ? " The system routes this pair to human validation." : outcome === "AUTO ISSUE" ? " No review is required; the codes were issued automatically." : " The items are treated as distinct.";
  const reasoning = sameTxt + diffTxt + simTxt + ` Risk: ${d.safetyRisk ?? "not calculated"}.` + outTxt;

  const outcomeWhy = outcome === "REJECT" ? "Not a match: " + d.reasons.join("; ") : outcome === "AUTO ISSUE" ? "Auto issue: " + d.reasons.join("; ") : "Human review: " + d.reasons.join("; ");

  return { outcome, checks, attrs, safety, reasoning, outcomeWhy, scores };
}

export { textSimilarity };
