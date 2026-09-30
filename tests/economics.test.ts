import { describe, it, expect, vi } from "vitest";
import { csvFile, installFakeLocalStorage } from "./helpers";

installFakeLocalStorage();
vi.mock("../src/lib/embeddings", () => ({
  getEmbedderStatus: () => "unavailable",
  embedSimilarity: async () => null,
  classifyBySimilarity: async () => null,
  warmupEmbedder: () => void 0,
  prefetchEmbeddings: async () => false,
  getEmbeddingStats: () => ({ modelTextsEmbedded: 0, cacheHits: 0, cacheSize: 0 }),
}));

const { runPipeline } = await import("../src/lib/pipeline");
const { computeEconomics, normalizeUom } = await import("../src/lib/economics");

const header = "Organization,Code,Description,UOM,Qty,Unit Price\n";
const run = (lines: string[]) => runPipeline([{ file: csvFile("e.csv", header + lines.join("\n") + "\n"), cpseId: "X" }]);

describe("economics — computed from the quantity/price columns that were previously parsed and ignored", () => {
  it("combined demand, total value and price-harmonisation opportunity for one shared code", async () => {
    const r = await run([
      "ONGC,O-1,HEX NUT M12 SS304 DIN934,NOS,100,10",
      "SAIL,S-1,Nut Hexagon M12 Stainless 304 DIN 934,EA,50,8",
      "BHEL,B-1,HEX NUT M12 SS304 DIN934,NOS,50,9",
    ]);
    expect(new Set(r.mapping.map((m) => m.nmcCode)).size).toBe(1);
    const e = computeEconomics(r.mapping, r.materials);
    const c = e.perCode[0];
    expect(c.totalQuantity).toBe(200);
    expect(c.uom).toBe("EA"); // NOS and EA are the same unit
    expect(c.value).toBe(100 * 10 + 50 * 8 + 50 * 9); // 1850
    expect(c.minPrice).toBe(8);
    expect(c.maxPrice).toBe(10);
    expect(c.harmonizationSavings).toBe(100 * (10 - 8) + 50 * (9 - 8)); // 250
    expect(c.weightedAvgPrice).toBe(9.25);
    expect(e.entries).toBe(3);
    expect(e.uniqueCodes).toBe(1);
    expect(e.redundantCodesEliminated).toBe(2);
    expect(e.catalogueReductionPct).toBeCloseTo(66.7, 1);
    expect(e.multiCpseCodes).toBe(1);
    expect(e.harmonizationSavings).toBe(250);
    expect(e.savingsPctOfValue).toBeCloseTo(13.5, 1);
    expect(e.topSavings[0].nmcCode).toBe(c.nmcCode);
    expect(e.topCombinedDemand[0].totalQuantity).toBe(200);
  });

  it("no harmonisation claimed for a single priced row, and different codes never mix", async () => {
    const r = await run(["ONGC,O-1,HEX NUT M12 SS304 DIN934,NOS,100,10", "SAIL,S-1,HEX NUT M16 SS304 DIN934,NOS,50,20"]);
    const e = computeEconomics(r.mapping, r.materials);
    expect(e.uniqueCodes).toBe(2);
    expect(e.harmonizationSavings).toBe(0);
    expect(e.totalValue).toBe(1000 + 1000);
  });

  it("mixed units of measure under one code are excluded from quantity and price maths (not summed into nonsense)", async () => {
    const r = await run(["ONGC,O-1,HEX NUT M12 SS304 DIN934,NOS,100,10", "SAIL,S-1,HEX NUT M12 SS304 DIN934,KG,5,500"]);
    const e = computeEconomics(r.mapping, r.materials);
    expect(e.perCode[0].uom).toBe("MIXED");
    expect(e.perCode[0].totalQuantity).toBeNull();
    expect(e.perCode[0].harmonizationSavings).toBe(0);
    expect(e.mixedUomCodes).toBe(1);
  });

  it("rows with missing quantity or price are counted, not silently treated as zero-cost", async () => {
    const r = await run([
      "ONGC,O-1,HEX NUT M12 SS304 DIN934,NOS,100,10",
      "SAIL,S-1,HEX NUT M12 SS304 DIN934,NOS,,8",
      "BHEL,B-1,HEX NUT M12 SS304 DIN934,NOS,40,",
    ]);
    const e = computeEconomics(r.mapping, r.materials);
    expect(e.withQuantity).toBe(2);
    expect(e.withPrice).toBe(2);
    expect(e.withBoth).toBe(1);
    expect(e.perCode[0].totalQuantity).toBe(140);
    expect(e.perCode[0].harmonizationSavings).toBe(0); // only one row had both
  });

  it("parses Indian/Western grouped and currency-prefixed numbers instead of truncating them at the comma", async () => {
    const r = await run([
      'ONGC,O-1,HEX NUT M12 SS304 DIN934,NOS,"1,25,000","₹1,250.50"',
      'SAIL,S-1,HEX NUT M12 SS304 DIN934,NOS,"2,500",Rs. 1200',
    ]);
    const m = r.materials;
    expect(m[0].quantity).toBe(125000);
    expect(m[0].unitPrice).toBe(1250.5);
    expect(m[1].quantity).toBe(2500);
    expect(m[1].unitPrice).toBe(1200);
  });

  it("follows supersession: demand pools under the code in force", async () => {
    const r = await run(["ONGC,O-1,HEX NUT M12 SS304 DIN934,NOS,10,5", "SAIL,S-1,HEX NUT M16 SS304 DIN934,NOS,20,5"]);
    const { applySupersessions } = await import("../src/lib/registry");
    const [a, b] = r.records.map((x) => x.nmcCode);
    const merged = applySupersessions(r, { [a]: { oldCode: a, newCode: b, reason: "r", by: ["x"], at: "" } });
    const e = computeEconomics(merged.mapping, merged.materials);
    expect(e.uniqueCodes).toBe(1);
    expect(e.perCode[0].totalQuantity).toBe(30);
  });

  it("handles an empty result", () => {
    const e = computeEconomics([], []);
    expect(e.catalogueReductionPct).toBe(0);
    expect(e.perCode).toEqual([]);
  });

  it("normalizeUom collapses common spellings", () => {
    expect(["NOS", "ea", "Pcs"].map(normalizeUom)).toEqual(["EA", "EA", "EA"]);
    expect(["MTR", "m"].map(normalizeUom)).toEqual(["M", "M"]);
    expect(normalizeUom("DRUM")).toBe("DRUM");
  });
});
