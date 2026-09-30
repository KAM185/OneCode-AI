import { describe, expect, it, beforeAll } from "vitest";
import { installFakeLocalStorage, csvFile } from "./helpers";
import {
  binCell, computeMetrics, computeSafety, confusion, datasetSummary, evaluateAi, evaluateBaseline, explainInput,
  pairsFromGrid, parseTruth, parseValidationFile, type EvalRow, type GroundTruth,
} from "../src/lib/validation";
import { scenarioPairs } from "../src/lib/validationData";

beforeAll(() => { installFakeLocalStorage(); });

const row = (truth: GroundTruth, predicted: GroundTruth, needsReview = false, risk: EvalRow["safetyRisk"] = null): EvalRow =>
  ({ pair: { id: "x", a: "a", b: "b", truth }, predicted, needsReview, safetyRisk: risk, confidence: 1, reasons: [] });
const many = (n: number, f: () => EvalRow) => Array.from({ length: n }, f);

describe("metrics from known counts", () => {
  // TP=6 FN=2 FP=1 TN=11 (n=20), 1 false merge, 3 reviewed
  const rows = [
    ...many(6, () => row("DUPLICATE", "DUPLICATE")),
    ...many(2, () => row("FUNCTIONALLY_EQUIVALENT", "NOT_EQUIVALENT")),
    row("NOT_EQUIVALENT", "DUPLICATE"),
    ...many(10, () => row("NOT_EQUIVALENT", "NOT_EQUIVALENT")),
    row("SIMILAR", "SIMILAR", true), row("SIMILAR", "SIMILAR", true), row("SIMILAR", "SIMILAR", true),
  ].slice(0, 20);
  it("computes confusion cells and rates", () => {
    const m = computeMetrics(rows);
    expect([m.tp, m.fn, m.fp, m.tn]).toEqual([6, 2, 1, 11]);
    expect(m.precision).toBeCloseTo(6 / 7); expect(m.recall).toBeCloseTo(6 / 8);
    expect(m.f1).toBeCloseTo((2 * (6 / 7) * (6 / 8)) / (6 / 7 + 6 / 8));
    expect(m.accuracy).toBeCloseTo(17 / 20);
    expect(m.falsePositiveRate).toBeCloseTo(1 / 12); expect(m.falseNegativeRate).toBeCloseTo(2 / 8);
  });
  it("false merge = automatic DUPLICATE on a non-duplicate", () => {
    const m = computeMetrics(rows);
    expect(m.autoMerges).toBe(7); expect(m.falseMerges).toBe(1);
    expect(m.falseMergeRate).toBeCloseTo(1 / 14); // non-duplicate truths = 14
  });
  it("a review-gated duplicate is not a false merge", () => {
    expect(computeMetrics([row("NOT_EQUIVALENT", "DUPLICATE", true)]).falseMerges).toBe(0);
  });
  it("similar counts as not-equivalent in the binary view", () => {
    expect(binCell(row("SIMILAR", "SIMILAR"))).toBe("TN");
    expect(binCell(row("SIMILAR", "DUPLICATE"))).toBe("FP");
    expect(binCell(row("DUPLICATE", "SIMILAR"))).toBe("FN");
  });
  it("returns null rather than inventing a rate on empty denominators", () => {
    const m = computeMetrics([row("NOT_EQUIVALENT", "NOT_EQUIVALENT")]);
    expect(m.precision).toBeNull(); expect(m.recall).toBeNull(); expect(m.f1).toBeNull();
    expect(m.sufficient).toBe(false); expect(m.insufficiencyReason).toMatch(/minimum/);
  });
  it("confusion matrix counts every row exactly once", () => {
    const c = confusion(rows);
    expect(Object.values(c).flatMap((r) => Object.values(r)).reduce((a, b) => a + b, 0)).toBe(rows.length);
    expect(c.DUPLICATE.DUPLICATE).toBe(6); expect(c.NOT_EQUIVALENT.DUPLICATE).toBe(1);
  });
});

describe("safety", () => {
  it("separates escaped merges from review-held ones", () => {
    const rows = [
      ...many(20, () => row("NOT_EQUIVALENT", "NOT_EQUIVALENT")),
      row("NOT_EQUIVALENT", "DUPLICATE"), row("NOT_EQUIVALENT", "SIMILAR", true),
      row("SIMILAR", "SIMILAR", true, "HIGH"), row("DUPLICATE", "NOT_EQUIVALENT", false, "HIGH"),
    ];
    const s = computeSafety(rows);
    expect(s.unsafeProposals).toBe(2); expect(s.autoMerged).toBe(1); expect(s.heldForReview).toBe(1);
    expect(s.highRisk).toBe(2); expect(s.sentToReview).toBe(1); expect(s.rejected).toBe(1);
    expect(s.sufficient).toBe(true);
  });
  it("flags insufficient data on a tiny set", () => {
    expect(computeSafety([row("NOT_EQUIVALENT", "DUPLICATE")]).sufficient).toBe(false);
  });
});

describe("dataset import", () => {
  it("parses labels and aliases", () => {
    expect(parseTruth("functionally equivalent")).toBe("FUNCTIONALLY_EQUIVALENT");
    expect(parseTruth("distinct")).toBe("NOT_EQUIVALENT"); expect(parseTruth("maybe")).toBeNull();
  });
  it("reads a CSV with header and reports bad rows", async () => {
    const f = csvFile("v.csv", "Material A,Material B,Ground Truth\nHEX NUT M12 SS304,HEX NUT M12 SS304,DUPLICATE\nX,Y,BOGUS\n,Z,SIMILAR\n");
    const r = await parseValidationFile(f);
    expect(r.pairs).toHaveLength(1); expect(r.errors).toHaveLength(2);
  });
  it("rejects a header without the required columns", () => {
    expect(pairsFromGrid([["foo", "bar", "truth"], ["a", "b", "DUPLICATE"]]).errors[0]).toMatch(/Header/);
  });
  it("summarises the prepared dataset", () => {
    const s = datasetSummary(scenarioPairs);
    expect(s.total).toBe(scenarioPairs.length);
    expect(s.duplicate + s.equivalent + s.similar + s.negative).toBe(s.total);
  });
});

describe("real matcher on rule-decided pairs", () => {
  it("evaluates, and does not merge different sizes", async () => {
    const pairs = [
      { id: "1", a: "HEX NUT M12 SS304 DIN934", b: "HEX NUT M12 SS304 DIN934", truth: "DUPLICATE" as const },
      { id: "2", a: "HEX NUT M12 SS304 DIN934", b: "HEX NUT M16 SS304 DIN934", truth: "NOT_EQUIVALENT" as const },
    ];
    const { rows } = await evaluateAi(pairs);
    expect(rows[0].predicted).toBe("DUPLICATE"); expect(rows[1].predicted).toBe("NOT_EQUIVALENT");
    expect(computeMetrics(rows).falseMerges).toBe(0);
    expect(explainInput(rows[0])?.materials.size).toBe(2);
  });
  it("baseline is deterministic and never routes to review", () => {
    const a = evaluateBaseline(scenarioPairs).rows, b = evaluateBaseline(scenarioPairs).rows;
    expect(a.map((r) => r.predicted)).toEqual(b.map((r) => r.predicted));
    expect(a.every((r) => !r.needsReview)).toBe(true);
  });
});
