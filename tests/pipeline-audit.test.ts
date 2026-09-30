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
const { loadAuditLog, verifyAuditChain } = await import("../src/lib/audit");

describe("runPipeline — audit trail", () => {
  it("REGRESSION: every issued code lands in the audit log (was: one entry for the whole run) and the chain verifies", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => `ONGC-${i},HEX NUT M${(i % 30) + 3} SS304 DIN934,NOS`).join("\n");
    const result = await runPipeline([{ file: csvFile("a.csv", `Code,Description,UOM\n${rows}\n`), cpseId: "ONGC" }]);
    const log = loadAuditLog();
    expect(result.stats.auditEntriesWritten).toBe(120);
    expect(log).toHaveLength(120);
    expect(log.every((e) => e.action.startsWith("code_issued_"))).toBe(true);
    expect((await verifyAuditChain()).valid).toBe(true);
    expect(result.runDigest).toBe(log[log.length - 1].hash.slice(0, 12));
  });
});
