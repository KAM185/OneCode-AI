// Material Intelligence Validation Lab — pure metric code.
// Every number is computed from a labelled dataset by running the REAL
// matcher (`decidePair`). Nothing here is hard-coded or estimated.
import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { MappingEntry, MatchDecision, ParsedMaterial, Rank } from "./types";
import { extractAttributes } from "./dictionary";
import { decidePair } from "./match";
import { contentTokens, jaccard, trigramCosine } from "./text";

export type GroundTruth = "DUPLICATE" | "FUNCTIONALLY_EQUIVALENT" | "SIMILAR" | "NOT_EQUIVALENT";
export const TRUTHS: GroundTruth[] = ["DUPLICATE", "FUNCTIONALLY_EQUIVALENT", "SIMILAR", "NOT_EQUIVALENT"];

/** Below these sizes a percentage would be noise, so the UI refuses to show one. */
export const MIN_PAIRS = 20;
export const MIN_PER_SIDE = 5;

export interface LabelledPair { id: string; a: string; b: string; truth: GroundTruth }

export interface EvalRow {
  pair: LabelledPair;
  predicted: GroundTruth;
  needsReview: boolean;
  safetyRisk: Rank | null;
  confidence: number;
  reasons: string[];
  decision?: MatchDecision;
  a?: ParsedMaterial;
  b?: ParsedMaterial;
}

// ---------- dataset loading ----------

export function parseTruth(raw: unknown): GroundTruth | null {
  const s = String(raw ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (s === "DISTINCT" || s === "NON_EQUIVALENT" || s === "NOT_EQUIVALENT") return "NOT_EQUIVALENT";
  return (TRUTHS as string[]).includes(s) ? (s as GroundTruth) : null;
}

export function pairsFromGrid(grid: unknown[][]): { pairs: LabelledPair[]; errors: string[] } {
  const rows = grid.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (rows.length === 0) return { pairs: [], errors: ["The file is empty."] };
  const head = rows[0].map((c) => String(c ?? "").toLowerCase());
  const hasHeader = head.some((h) => /truth|label/.test(h));
  let ia = 0, ib = 1, it = 2;
  if (hasHeader) {
    ia = head.findIndex((h) => /material\s*_?a|^a$|first/.test(h.trim()));
    ib = head.findIndex((h) => /material\s*_?b|^b$|second/.test(h.trim()));
    it = head.findIndex((h) => /truth|label/.test(h));
    if (ia < 0 || ib < 0 || it < 0) return { pairs: [], errors: ["Header must contain 'Material A', 'Material B' and 'Ground Truth' columns."] };
  }
  const pairs: LabelledPair[] = [];
  const errors: string[] = [];
  rows.slice(hasHeader ? 1 : 0).forEach((r, i) => {
    const line = i + (hasHeader ? 2 : 1);
    const a = String(r[ia] ?? "").trim(), b = String(r[ib] ?? "").trim(), truth = parseTruth(r[it]);
    if (!a || !b) errors.push(`Row ${line}: both material descriptions are required.`);
    else if (!truth) errors.push(`Row ${line}: unknown ground truth "${String(r[it] ?? "")}" (use ${TRUTHS.join(", ")}).`);
    else pairs.push({ id: `P${pairs.length + 1}`, a, b, truth });
  });
  return { pairs, errors };
}

export async function parseValidationFile(file: File): Promise<{ pairs: LabelledPair[]; errors: string[] }> {
  const name = file.name.toLowerCase();
  if (/\.xlsx?$/.test(name)) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return pairsFromGrid(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false }));
  }
  const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: true });
  return pairsFromGrid(parsed.data);
}

// ---------- running the matcher ----------

export function buildMaterial(description: string, id: string): ParsedMaterial {
  const ex = extractAttributes(description);
  return {
    id, cpseId: "VALIDATION", sourceFile: "validation-dataset", rowNumber: 0,
    rawDescription: description, ownCode: id, uom: "", quantity: null, unitPrice: null,
    category: ex.category, catCode: ex.catCode, subtype: ex.subtype, attrs: ex.attrs,
    corrosionClass: ex.corrosionClass, strengthRank: ex.strengthRank, classifiedBy: "rules",
  };
}

export function toTruthLabel(v: MatchDecision["verdict"]): GroundTruth {
  return v === "duplicate" ? "DUPLICATE" : v === "functionally_equivalent" ? "FUNCTIONALLY_EQUIVALENT" : v === "similar" ? "SIMILAR" : "NOT_EQUIVALENT";
}

export async function evaluateAi(pairs: LabelledPair[]): Promise<{ rows: EvalRow[]; ms: number }> {
  const t0 = performance.now();
  const rows: EvalRow[] = [];
  for (const pair of pairs) {
    const a = buildMaterial(pair.a, `${pair.id}-A`), b = buildMaterial(pair.b, `${pair.id}-B`);
    const d = await decidePair(a, b);
    rows.push({ pair, predicted: toTruthLabel(d.verdict), needsReview: d.needsReview, safetyRisk: d.safetyRisk, confidence: d.confidence, reasons: d.reasons, decision: d, a, b });
  }
  return { rows, ms: performance.now() - t0 };
}

/** Reference baseline: plain description-text similarity with one threshold and
 * no attribute rules, no safety logic, no human-review gate. */
export const BASELINE_THRESHOLD = 0.8;
export function evaluateBaseline(pairs: LabelledPair[]): { rows: EvalRow[]; ms: number } {
  const t0 = performance.now();
  const rows = pairs.map((pair): EvalRow => {
    const score = 0.5 * jaccard(contentTokens(pair.a), contentTokens(pair.b)) + 0.5 * trigramCosine(pair.a, pair.b);
    const merge = score >= BASELINE_THRESHOLD;
    return { pair, predicted: merge ? "DUPLICATE" : "NOT_EQUIVALENT", needsReview: false, safetyRisk: null, confidence: score, reasons: [`Text similarity ${score.toFixed(2)} ${merge ? "≥" : "<"} ${BASELINE_THRESHOLD}`] };
  });
  return { rows, ms: performance.now() - t0 };
}

// ---------- metrics ----------

/** Binary view: "equivalent" = DUPLICATE or FUNCTIONALLY_EQUIVALENT. SIMILAR is
 * NOT treated as equivalent on either side (it is not safe to substitute
 * without review). */
export const isPositive = (t: GroundTruth) => t === "DUPLICATE" || t === "FUNCTIONALLY_EQUIVALENT";
export type BinCell = "TP" | "TN" | "FP" | "FN";
export const binCell = (r: EvalRow): BinCell =>
  isPositive(r.pair.truth) ? (isPositive(r.predicted) ? "TP" : "FN") : (isPositive(r.predicted) ? "FP" : "TN");
/** A merge that happens with NO human in the loop. */
export const isAutoMerge = (r: EvalRow) => r.predicted === "DUPLICATE" && !r.needsReview;

const ratio = (n: number, d: number): number | null => (d === 0 ? null : n / d);

export interface Metrics {
  n: number; tp: number; tn: number; fp: number; fn: number;
  precision: number | null; recall: number | null; f1: number | null; accuracy: number | null;
  exactClassAccuracy: number | null;
  falsePositiveRate: number | null; falseNegativeRate: number | null;
  falseMergeRate: number | null; falseMerges: number; autoMerges: number;
  humanReviewRate: number | null; reviewed: number;
  sufficient: boolean; insufficiencyReason: string | null;
}

export function computeMetrics(rows: EvalRow[]): Metrics {
  const c = { TP: 0, TN: 0, FP: 0, FN: 0 };
  let exact = 0, reviewed = 0, autoMerges = 0, falseMerges = 0, nonDup = 0;
  for (const r of rows) {
    c[binCell(r)]++;
    if (r.predicted === r.pair.truth) exact++;
    if (r.needsReview) reviewed++;
    if (r.pair.truth !== "DUPLICATE") nonDup++;
    if (isAutoMerge(r)) { autoMerges++; if (r.pair.truth !== "DUPLICATE") falseMerges++; }
  }
  const n = rows.length, { TP: tp, TN: tn, FP: fp, FN: fn } = c;
  const precision = ratio(tp, tp + fp), recall = ratio(tp, tp + fn);
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  const pos = tp + fn, neg = tn + fp;
  const reason = n < MIN_PAIRS ? `Only ${n} labelled pairs (minimum ${MIN_PAIRS}).`
    : pos < MIN_PER_SIDE ? `Only ${pos} equivalent pairs (minimum ${MIN_PER_SIDE}).`
    : neg < MIN_PER_SIDE ? `Only ${neg} non-equivalent pairs (minimum ${MIN_PER_SIDE}).` : null;
  return {
    n, tp, tn, fp, fn, precision, recall, f1, accuracy: ratio(tp + tn, n), exactClassAccuracy: ratio(exact, n),
    falsePositiveRate: ratio(fp, fp + tn), falseNegativeRate: ratio(fn, fn + tp),
    falseMergeRate: ratio(falseMerges, nonDup), falseMerges, autoMerges,
    humanReviewRate: ratio(reviewed, n), reviewed,
    sufficient: reason === null, insufficiencyReason: reason,
  };
}

export function confusion(rows: EvalRow[]): Record<GroundTruth, Record<GroundTruth, number>> {
  const m = {} as Record<GroundTruth, Record<GroundTruth, number>>;
  for (const t of TRUTHS) { m[t] = {} as Record<GroundTruth, number>; for (const p of TRUTHS) m[t][p] = 0; }
  for (const r of rows) m[r.pair.truth][r.predicted]++;
  return m;
}

export function datasetSummary(pairs: LabelledPair[]) {
  const by = (t: GroundTruth) => pairs.filter((p) => p.truth === t).length;
  return { total: pairs.length, duplicate: by("DUPLICATE"), equivalent: by("FUNCTIONALLY_EQUIVALENT"), similar: by("SIMILAR"), negative: by("NOT_EQUIVALENT") };
}

export interface Safety {
  negatives: number;
  unsafeProposals: number;   // AI linked/merged a pair ground truth says is NOT equivalent
  autoMerged: number;        // ...and no human gate stood in the way (false merges)
  heldForReview: number;     // ...but a human review gate caught it
  correctlyRejected: number; // AI said not-equivalent, ground truth agrees
  highRisk: number; sentToReview: number; rejected: number; autoAccepted: number;
  sufficient: boolean;
}

export function computeSafety(rows: EvalRow[]): Safety {
  const neg = rows.filter((r) => r.pair.truth === "NOT_EQUIVALENT");
  const unsafe = neg.filter((r) => r.predicted !== "NOT_EQUIVALENT");
  const hr = rows.filter((r) => r.safetyRisk === "HIGH");
  return {
    negatives: neg.length, unsafeProposals: unsafe.length,
    autoMerged: unsafe.filter(isAutoMerge).length, heldForReview: unsafe.filter((r) => !isAutoMerge(r) && r.needsReview).length,
    correctlyRejected: neg.length - unsafe.length,
    highRisk: hr.length, sentToReview: hr.filter((r) => r.needsReview).length,
    rejected: hr.filter((r) => r.predicted === "NOT_EQUIVALENT").length,
    autoAccepted: hr.filter((r) => !r.needsReview && r.predicted !== "NOT_EQUIVALENT").length,
    sufficient: rows.length >= MIN_PAIRS && neg.length >= MIN_PER_SIDE,
  };
}

/** Lets the existing ExplainDrawer show evidence for a validation pair. */
export function explainInput(r: EvalRow): { entry: MappingEntry; materials: Map<string, ParsedMaterial> } | null {
  if (!r.decision || !r.a || !r.b) return null;
  const entry: MappingEntry = { materialId: r.a.id, cpseId: "VALIDATION", ownCode: r.a.id, description: r.a.rawDescription, uom: "", nmcCode: r.decision.matchedNmcCode ?? "", originalNmcCode: r.decision.matchedNmcCode ?? "", status: r.needsReview ? "pending-review" : "auto-issued", decision: r.decision };
  return { entry, materials: new Map([[r.a.id, r.a], [r.b.id, r.b]]) };
}
