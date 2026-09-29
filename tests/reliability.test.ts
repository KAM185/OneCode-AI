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

import { parseCpseFile, ParseError } from "../src/lib/parse";
import { runPipeline } from "../src/lib/pipeline";
import { applyReview } from "../src/lib/review";
import { mergeLink } from "../src/lib/registry";

describe("upload reliability", () => {
  it("rejects unsupported file types and files without a description column", async () => {
    await expect(parseCpseFile(csvFile("a.pdf", "x"), "IOCL")).rejects.toBeInstanceOf(ParseError);
    await expect(parseCpseFile(csvFile("a.csv", "Code,Qty\n1,2\n3,4\n"), "IOCL")).rejects.toBeInstanceOf(ParseError);
  });
  it("fails clearly when no row has a description", async () => {
    await expect(runPipeline([{ file: csvFile("e.csv", "Description\n\n\n"), cpseId: "IOCL" }], undefined, { supersessions: {} })).rejects.toBeInstanceOf(ParseError);
  });
});

describe("end-to-end: dimension mismatch, review → registry, cross-CPSE", () => {
  it("keeps different sizes distinct and persists a confirmed cross-CPSE link", async () => {
    const A = "Code,Description\nA1,Hex nut M12 SS304 DIN 934\nA2,Hex nut M16 SS304 DIN 934\n";
    const B = "Code,Description\nB1,Hex nut M12 carbon steel gr 8 DIN 934\n";
    const r = await runPipeline([{ file: csvFile("a.csv", A), cpseId: "IOCL" }, { file: csvFile("b.csv", B), cpseId: "BPCL" }], undefined, { supersessions: {} });
    const m12 = r.mapping.filter((e) => /M12/.test(e.description));
    const m16 = r.mapping.find((e) => /M16/.test(e.description))!;
    expect(m16.decision.verdict).toBe("distinct");            // dimension mismatch never merges
    expect(m12[0].nmcCode).not.toBe(m16.nmcCode);
    const pending = r.mapping.find((e) => e.status === "pending-review");
    expect(pending).toBeDefined();
    if (pending) {                                            // different grade → routed to review, not auto-issued
      const app = applyReview(r, pending, "confirmed", ["rev1", "rev2"], {});
      expect(app.result.mapping.find((e) => e.materialId === pending.materialId)!.status).toBe("reviewed-confirmed");
      expect(app.link).not.toBeNull();
      if (app.link) {
        const links = mergeLink([], app.link);
        expect(links[0].cpseIds.length).toBeGreaterThan(0);
        expect(links[0].members!.length).toBeGreaterThan(0);
      }
    }
  });
});
