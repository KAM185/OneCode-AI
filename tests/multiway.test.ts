import { describe, it, expect, vi } from "vitest";

vi.mock("../src/lib/embeddings", () => ({
  getEmbedderStatus: () => "unavailable",
  embedSimilarity: async () => null,
  classifyBySimilarity: async () => null,
  warmupEmbedder: () => void 0,
  prefetchEmbeddings: async () => false,
  getEmbeddingStats: () => ({ modelTextsEmbedded: 0, cacheHits: 0, cacheSize: 0 }),
}));

const { runPipeline } = await import("../src/lib/pipeline");
const { findBestMatch, isBetterDecision, dimKey } = await import("../src/lib/match");
const { extractAttributes } = await import("../src/lib/dictionary");
import type { MatchDecision, ParsedMaterial } from "../src/lib/types";

const csv = (rows: string[]) => new File([`Code,Description,UOM\n${rows.map((r, i) => `X-${i + 1},${r},NOS`).join("\n")}\n`], "t.csv", { type: "text/csv" });

function dec(verdict: MatchDecision["verdict"], confidence: number, extra: Partial<MatchDecision> = {}): MatchDecision {
  return { materialId: "m", matchedMaterialId: "x", matchedNmcCode: "C", verdict, confidence, stage: "rule", reasons: [], safetyRisk: "LOW", needsReview: verdict !== "duplicate", ...extra };
}
function mk(desc: string): ParsedMaterial {
  const ex = extractAttributes(desc);
  return { id: desc, cpseId: "ONGC", sourceFile: "t", rowNumber: 1, rawDescription: desc, ownCode: "X", uom: "NOS", quantity: null, unitPrice: null, category: ex.category, catCode: ex.catCode, subtype: ex.subtype, attrs: ex.attrs, corrosionClass: ex.corrosionClass, strengthRank: ex.strengthRank, classifiedBy: "rules" };
}

describe("isBetterDecision", () => {
  it("orders by verdict strength, then confidence, then lower safety risk; ties keep the incumbent", () => {
    expect(isBetterDecision(dec("duplicate", 0.9), dec("functionally_equivalent", 0.99))).toBe(true);
    expect(isBetterDecision(dec("similar", 0.95), dec("functionally_equivalent", 0.6))).toBe(false);
    expect(isBetterDecision(dec("similar", 0.9), dec("similar", 0.7))).toBe(true);
    expect(isBetterDecision(dec("similar", 0.7, { safetyRisk: "LOW" }), dec("similar", 0.7, { safetyRisk: "HIGH" }))).toBe(true);
    expect(isBetterDecision(dec("similar", 0.7), dec("similar", 0.7))).toBe(false);
    expect(isBetterDecision(dec("distinct", 1), null)).toBe(true);
  });
});

describe("findBestMatch", () => {
  const candidates = (n: number) => Array.from({ length: n }, (_, i) => ({ material: mk(`HEX NUT M12 SS304 c${i}`), payload: i }));

  it("does not settle for the first non-distinct match — a later exact duplicate wins", async () => {
    const script: MatchDecision[] = [dec("distinct", 1), dec("similar", 0.85), dec("functionally_equivalent", 0.75), dec("similar", 0.7), dec("duplicate", 1)];
    let i = 0;
    const best = await findBestMatch(mk("HEX NUT M12 SS304"), candidates(5), async () => script[i++]);
    expect(best.decision?.verdict).toBe("duplicate");
    expect(best.candidate?.payload).toBe(4);
    expect(best.nonDistinct).toBe(4);
    expect(best.comparisons).toBe(5);
  });

  it("stops early ONLY on a perfect, review-free duplicate (nothing can beat it)", async () => {
    let calls = 0;
    const script = [dec("similar", 0.8), dec("duplicate", 1), dec("duplicate", 1), dec("duplicate", 1)];
    const best = await findBestMatch(mk("HEX NUT M12 SS304"), candidates(4), async () => script[calls++]);
    expect(calls).toBe(2);
    expect(best.candidate?.payload).toBe(1);
  });

  it("does not early-exit on a duplicate that still needs review", async () => {
    let calls = 0;
    const script = [dec("duplicate", 0.93, { needsReview: true }), dec("duplicate", 1)];
    const best = await findBestMatch(mk("HEX NUT M12 SS304"), candidates(2), async () => script[calls++]);
    expect(calls).toBe(2);
    expect(best.decision?.confidence).toBe(1);
  });

  it("returns a null decision when everything is distinct", async () => {
    const best = await findBestMatch(mk("HEX NUT M12 SS304"), candidates(3), async () => dec("distinct", 1));
    expect(best.decision).toBeNull();
    expect(best.nonDistinct).toBe(0);
  });
});

describe("pipeline picks the best match, not the first", () => {
  it("REGRESSION: a later exact duplicate beats an earlier 'similar' (old early-exit picked the earlier one)", async () => {
    const result = await runPipeline([
      { file: csv(["HEX NUT M12 SS304 DIN934", "HEX NUT M12 SS304 ISO4032", "Nut Hexagon M12 Stainless 304 ISO 4032"]), cpseId: "ONGC" },
    ]);
    const [a, b, c] = result.mapping;
    expect(a.nmcCode).not.toBe(b.nmcCode);
    expect(b.decision.verdict).toBe("similar"); // vs A: standards differ
    // C is identical to B; the old loop compared it to A first, hit "similar",
    // and stopped — leaving C un-merged and in the review queue.
    expect(c.decision.verdict).toBe("duplicate");
    expect(c.nmcCode).toBe(b.nmcCode);
    expect(c.decision.matchedNmcCode).toBe(b.nmcCode);
    expect(c.status).toBe("auto-issued");
  });

  it("matchedNmcCode is the code in force for the matched item (post-merge), not a recomputation", async () => {
    const result = await runPipeline([{ file: csv(["HEX NUT M12 SS304 DIN934", "Nut Hexagon M12 SS304 DIN 934", "HEX NUT M12 SS316 DIN934"]), cpseId: "ONGC" }]);
    const [a, b, c] = result.mapping;
    expect(b.nmcCode).toBe(a.nmcCode);
    expect(c.decision.matchedNmcCode).toBe(a.nmcCode);
  });

  it("items with different dimensions are never compared at all (dimension gate, identical results, far fewer pairs)", async () => {
    const sizes = ["M6", "M8", "M10", "M12", "M16", "M20", "M24", "M30"];
    const result = await runPipeline([{ file: csv(sizes.map((s) => `HEX NUT ${s} SS304 DIN934`)), cpseId: "ONGC" }]);
    expect(result.stats.comparisons).toBe(0);
    expect(new Set(result.mapping.map((m) => m.nmcCode)).size).toBe(8);
  });

  it("dimKey is null for incomplete identities so they are still compared against everything", () => {
    expect(dimKey(mk("HEX NUT M12 SS304 DIN934"))).toBe("M12");
    expect(dimKey(mk("MYSTERY WIDGET"))).toBeNull();
  });

  it("scales: 3,000 rows across 300 dimension groups finish quickly with bounded comparisons", async () => {
    const rows: string[] = [];
    for (let s = 0; s < 300; s++) for (let k = 0; k < 10; k++) rows.push(`HEX NUT M${s + 1} SS304 DIN934${k % 2 ? "" : " STD"}`);
    const t0 = performance.now();
    const result = await runPipeline([{ file: csv(rows), cpseId: "ONGC" }]);
    const ms = performance.now() - t0;
    expect(result.mapping).toHaveLength(3000);
    expect(new Set(result.mapping.map((m) => m.nmcCode)).size).toBe(300);
    expect(result.stats.comparisons).toBeLessThan(3000 * 2); // O(n), not O(n^2) = ~4.5M
    expect(ms).toBeLessThan(15_000);
  });
});
