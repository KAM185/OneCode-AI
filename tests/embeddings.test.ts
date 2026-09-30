import { describe, it, expect, vi, beforeEach } from "vitest";

// Fake model: deterministic, L2-normalised bag-of-trigrams vectors, and a
// call log so we can prove exactly which texts reached the "model".
const calls: string[][] = [];
function fakeVector(text: string): number[] {
  const v = new Array(32).fill(0);
  const t = `  ${text.toLowerCase()} `;
  for (let i = 0; i < t.length - 2; i++) {
    let h = 0;
    for (const ch of t.slice(i, i + 3)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % 32] += 1;
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
const fakeExtractor = async (texts: string[]) => {
  calls.push([...texts]);
  const data = new Float32Array(texts.length * 32);
  texts.forEach((t, i) => data.set(fakeVector(t), i * 32));
  return { dims: [texts.length, 32], data };
};

let mod: typeof import("../src/lib/embeddings");
beforeEach(async () => {
  calls.length = 0;
  vi.resetModules();
  vi.doMock("@huggingface/transformers", () => ({ pipeline: async () => fakeExtractor }));
  mod = await import("../src/lib/embeddings");
});

const modelTexts = () => calls.flat();

describe("embedding cache", () => {
  it("embeds a repeated description once, however many comparisons use it", async () => {
    const a = "HEX NUT M12 SS304 DIN 934";
    for (const other of ["HEX NUT M12 SS316", "HEX NUT M12 MS", "Nut hexagon M12 SS304", "HEX NUT M12 BRASS"]) {
      await mod.embedSimilarity(a, other);
    }
    // A appears in 4 comparisons but reaches the model exactly once.
    expect(modelTexts().filter((t) => t === a)).toHaveLength(1);
    expect(modelTexts()).toHaveLength(5); // A + 4 distinct others
    expect(mod.getEmbeddingStats().cacheHits).toBe(3);
  });

  it("dedupes within a batch and treats whitespace/case variants as one text", async () => {
    await mod.embedBatch(["Hex Nut  M12", "hex nut m12", "HEX NUT M12 ", "gate valve"]);
    expect(modelTexts()).toHaveLength(2);
  });

  it("after a prefetch, similarity lookups make ZERO further model calls", async () => {
    const texts = ["hex nut m12 ss304", "hex nut m12 ss316", "gate valve 4 inch"];
    await mod.prefetchEmbeddings(texts);
    const callsAfterPrefetch = calls.length;
    for (const a of texts) for (const b of texts) await mod.embedSimilarity(a, b);
    expect(calls.length).toBe(callsAfterPrefetch);
  });

  it("returns identical vectors from cache (similarity of a text with itself is 1)", async () => {
    const s = await mod.embedSimilarity("ball bearing 6205", "ball bearing 6205");
    expect(s).toBeCloseTo(1, 5);
  });

  it("classifyBySimilarity embeds the subtype prototypes once, not once per row", async () => {
    const protos = [
      { code: "HNT", text: "hex nut fastener" },
      { code: "GTV", text: "gate valve" },
      { code: "BRG", text: "ball bearing" },
    ];
    for (const row of ["nut hexagonal zinc plated", "gate type valve flanged", "bearing deep groove"]) {
      await mod.classifyBySimilarity(row, protos);
    }
    for (const p of protos) expect(modelTexts().filter((t) => t === p.text)).toHaveLength(1);
    expect(modelTexts()).toHaveLength(3 + 3); // 3 prototypes + 3 rows
  });

  it("batches large prefetches into chunks of 32 model inputs", async () => {
    await mod.prefetchEmbeddings(Array.from({ length: 70 }, (_, i) => `material description number ${i}`));
    expect(calls.map((c) => c.length)).toEqual([32, 32, 6]);
  });

  it("returns null (never throws) when the model cannot load, so callers use the lexical fallback", async () => {
    vi.resetModules();
    vi.doMock("@huggingface/transformers", () => ({ pipeline: async () => { throw new Error("offline"); } }));
    const offline = await import("../src/lib/embeddings");
    expect(await offline.embedSimilarity("a", "b")).toBeNull();
    expect(offline.getEmbedderStatus()).toBe("unavailable");
    expect(await offline.prefetchEmbeddings(["x"])).toBe(false);
  });
});
