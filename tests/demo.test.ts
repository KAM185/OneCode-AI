import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("../src/lib/embeddings", () => ({
  getEmbedderStatus: () => "unavailable",
  embedSimilarity: async () => null,
  classifyBySimilarity: async () => null,
  warmupEmbedder: () => void 0,
  prefetchEmbeddings: async () => false,
  getEmbeddingStats: () => ({ modelTextsEmbedded: 0, cacheHits: 0, cacheSize: 0 }),
}));

const { DEMO_FILES, DEMO_BASE, loadDemoUploads, detectCpseFromFilename } = await import("../src/lib/demo");
const { headlineStats } = await import("../src/lib/headline");
const { runPipeline } = await import("../src/lib/pipeline");

const PUBLIC = path.resolve(__dirname, "../public");

/** Serves /sample-data/* straight from the public folder, like the deployed site. */
const fileFetch = (async (url: string) => {
  const p = path.join(PUBLIC, url);
  if (!fs.existsSync(p)) return new Response("not found", { status: 404 });
  return new Response(fs.readFileSync(p));
}) as unknown as typeof fetch;

describe("demo data", () => {
  it("covers exactly the 8 CPSEs, each file present in public/sample-data", () => {
    expect(DEMO_FILES.map((d) => d.cpseId).sort()).toEqual(["BHEL", "BPCL", "CPCL", "HPCL", "IOCL", "NTPC", "ONGC", "SAIL"]);
    for (const d of DEMO_FILES) expect(fs.existsSync(path.join(PUBLIC, DEMO_BASE, d.file))).toBe(true);
  });

  it("reports a clear error when a demo file cannot be fetched", async () => {
    const failing = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(loadDemoUploads(failing)).rejects.toThrow(/Could not load demo file/);
  });

  it("runs end to end: every CPSE appears and the headline is counted from the run", async () => {
    const uploads = await loadDemoUploads(fileFetch);
    expect(uploads).toHaveLength(8);
    const result = await runPipeline(uploads, undefined, { supersessions: {} });
    const h = headlineStats(result);
    expect(h.cpses).toBe(8);
    expect(h.items).toBe(result.materials.length);
    expect(h.items).toBeGreaterThan(900);
    expect(h.codes).toBeLessThan(h.items); // cross-CPSE convergence actually reduces the catalogue
    expect(h.reductionPct).toBeGreaterThan(0);
    expect(h.pendingReview).toBeGreaterThan(0); // the demo must exercise the review queue
    expect(h.highRisk).toBeGreaterThan(0); // ...and the safety flag
  });
});

describe("detectCpseFromFilename", () => {
  it("reads the CPSE from the file name", () => {
    expect(detectCpseFromFilename("ONGC_material_master.csv")).toBe("ONGC");
    expect(detectCpseFromFilename("hpcl-stock.xlsx")).toBe("HPCL");
    expect(detectCpseFromFilename("Coal India Q3.csv")).toBe("COAL INDIA");
  });
  it("returns null when no CPSE is named, and never matches inside a word", () => {
    expect(detectCpseFromFilename("ALL_8_CPSE_mixed.csv")).toBeNull();
    expect(detectCpseFromFilename("material_master.csv")).toBeNull();
    expect(detectCpseFromFilename("TOILET_stock.csv")).toBeNull();
  });
});
