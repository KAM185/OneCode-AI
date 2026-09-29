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

function csvFile(name: string, content: string): File {
  return new File([content], name, { type: "text/csv" });
}

describe("runPipeline — end to end", () => {
  it("converges two differently-worded CPSE files on the same NMC code for the same hex nut", async () => {
    const ongc = csvFile("ongc.csv", "MATNR,MAKTX,MEINS\nONGC-FAS-0093,HEX NUT M12 SS304 DIN 934,NOS\n");
    const sail = csvFile(
      "sail.csv",
      "Material Code,Material Description,Unit\nSAIL-NUT-0087,Nut Hexagon M12 Stainless Steel 304 DIN934 STD,EA\n"
    );

    const result = await runPipeline([
      { file: ongc, cpseId: "ONGC" },
      { file: sail, cpseId: "SAIL" },
    ]);

    expect(result.mapping).toHaveLength(2);
    const [a, b] = result.mapping;
    expect(a.nmcCode).toBe(b.nmcCode);
    expect(a.status).toBe("auto-issued");
    expect(b.decision.verdict).toBe("duplicate");
  });

  it("flags a near-miss (grade downgrade) for review instead of silently merging", async () => {
    const ongc = csvFile("ongc.csv", "Code,Description,UOM\nONGC-1,HEX NUT M12 SS304 DIN934,NOS\n");
    const sail = csvFile("sail.csv", "Code,Description,UOM\nSAIL-1,HEX NUT M12 MS ZINC PLATED DIN934,NOS\n");

    const result = await runPipeline([
      { file: ongc, cpseId: "ONGC" },
      { file: sail, cpseId: "SAIL" },
    ]);

    const second = result.mapping[1];
    expect(second.status).toBe("pending-review");
    expect(second.nmcCode).not.toBe(result.mapping[0].nmcCode);
  });

  it("issues distinct codes for a mixed batch across categories without cross-contamination", async () => {
    const mixed = csvFile(
      "mixed.csv",
      "Organization,Code,Description,UOM\n" +
        "ONGC,O-1,HEX NUT M12 SS304 DIN934,NOS\n" +
        "SAIL,S-1,GATE VALVE 4 INCH CLASS 300 WCB,NOS\n" +
        "BHEL,B-1,BALL BEARING 6205 2RS,NOS\n"
    );
    const result = await runPipeline([{ file: mixed, cpseId: "FALLBACK" }]);
    expect(result.materials.map((m) => m.cpseId)).toEqual(["ONGC", "SAIL", "BHEL"]);
    const codes = new Set(result.mapping.map((m) => m.nmcCode));
    expect(codes.size).toBe(3); // no accidental collisions across unrelated categories
  });

  it("stats report skipped rows and stage counts accurately", async () => {
    const file = csvFile("gaps.csv", "Code,Description,UOM\nX-1,HEX NUT M12 SS304 DIN934,NOS\nX-2,,NOS\n");
    const result = await runPipeline([{ file, cpseId: "CPCL" }]);
    expect(result.stats.skippedEmptyRows).toBe(1);
    expect(result.stats.materials).toBe(1);
  });
});
