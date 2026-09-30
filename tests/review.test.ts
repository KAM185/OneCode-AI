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
const { applyReview, linkTargetFor } = await import("../src/lib/review");
const { mergeLink, linkId } = await import("../src/lib/registry");
import type { PipelineResult } from "../src/lib/types";

const run = (rows: string[]) => runPipeline([{ file: csvFile("t.csv", `Code,Description,UOM\n${rows.map((r, i) => `C-${i + 1},${r},NOS`).join("\n")}\n`), cpseId: "ONGC" }]);
const pending = (r: PipelineResult) => r.mapping.filter((m) => m.status === "pending-review");

describe("confirmed equivalence is persisted as a validated link (linkedNmcCode)", () => {
  it("REGRESSION: confirming records WHICH code it is linked to; previously only the status changed", async () => {
    const r = await run(["HEX NUT M12 SS304 DIN934", "HEX NUT M12 SS316 DIN934"]);
    const [first, second] = r.mapping;
    expect(second.status).toBe("pending-review");
    expect(second.decision.verdict).toBe("functionally_equivalent");
    expect(linkTargetFor(second)).toBe(first.nmcCode);

    const { result, link } = applyReview(r, second, "confirmed", ["alice"], {}, 7);
    const after = result.mapping[1];
    expect(after.status).toBe("reviewed-confirmed");
    expect(after.linkedNmcCode).toBe(first.nmcCode);
    expect(after.nmcCode).toBe(second.nmcCode); // codes stay SEPARATE for a substitute
    expect(after.reviewedBy).toEqual(["alice"]);
    expect(after.decision).toEqual(second.decision); // original AI decision never overwritten
    expect(link).toMatchObject({ codeA: second.nmcCode, codeB: first.nmcCode, cpseId: "ONGC", confirmedBy: ["alice"], auditSeq: 7 });
  });

  it("does not mutate the input result (pure transition)", async () => {
    const r = await run(["HEX NUT M12 SS304 DIN934", "HEX NUT M12 SS316 DIN934"]);
    const snapshot = JSON.stringify(r.mapping);
    applyReview(r, r.mapping[1], "confirmed", ["a"], {});
    expect(JSON.stringify(r.mapping)).toBe(snapshot);
  });

  it("rejecting an equivalence links nothing", async () => {
    const r = await run(["HEX NUT M12 SS304 DIN934", "HEX NUT M12 SS316 DIN934"]);
    const { result, link } = applyReview(r, r.mapping[1], "rejected", ["bob"], {});
    expect(link).toBeNull();
    expect(result.mapping[1].status).toBe("reviewed-rejected");
    expect(result.mapping[1].linkedNmcCode).toBeUndefined();
  });

  it("only acts on items actually pending review", async () => {
    const r = await run(["HEX NUT M12 SS304 DIN934", "HEX NUT M12 SS316 DIN934"]);
    const { result, link } = applyReview(r, r.mapping[0], "confirmed", ["a"], {}); // auto-issued
    expect(result).toBe(r);
    expect(link).toBeNull();
    const once = applyReview(r, r.mapping[1], "confirmed", ["a"], {}).result;
    expect(applyReview(once, once.mapping[1], "rejected", ["b"], {}).result).toBe(once); // can't flip a resolved item
  });
});

describe("rejecting a merge un-merges the row", () => {
  it("REGRESSION: a rejected near-duplicate reverts to its own code (status used to flip while the merged code silently stayed)", async () => {
    const r = await run([
      "MYSTERY WIDGET ALPHA BRACKET PUMP SKID ASSEMBLY STAINLESS",
      "MYSTERY WIDGET ALPHA BRACKET PUMP SKID ASSEMBLY STAINLESS STEEL",
    ]);
    const second = r.mapping[1];
    expect(second.decision.verdict).toBe("duplicate");
    expect(second.status).toBe("pending-review");
    expect(second.nmcCode).toBe(r.mapping[0].nmcCode); // merged, pending confirmation

    const { result } = applyReview(r, second, "rejected", ["carol"], {});
    const after = result.mapping[1];
    expect(after.status).toBe("reviewed-rejected");
    expect(after.nmcCode).not.toBe(r.mapping[0].nmcCode); // now its own code
    expect(after.originalNmcCode).toBe(second.originalNmcCode); // history preserved
    expect(result.records.some((rec) => rec.nmcCode === after.nmcCode)).toBe(true); // and it has a record
  });

  it("confirming a merge keeps the merged code and creates no substitute link", async () => {
    const r = await run([
      "MYSTERY WIDGET ALPHA BRACKET PUMP SKID ASSEMBLY STAINLESS",
      "MYSTERY WIDGET ALPHA BRACKET PUMP SKID ASSEMBLY STAINLESS STEEL",
    ]);
    const { result, link } = applyReview(r, r.mapping[1], "confirmed", ["carol"], {});
    expect(result.mapping[1].nmcCode).toBe(r.mapping[0].nmcCode);
    expect(link).toBeNull();
  });
});

describe("substitution reference table", () => {
  const decision = { verdict: "functionally_equivalent" as const, safetyRisk: "LOW" as const, confidence: 0.75, reasons: ["r"] };

  it("stores each pair once, order-independent, and accumulates evidence instead of duplicating", () => {
    let links = mergeLink([], { codeA: "NMC-B", codeB: "NMC-A", decision, cpseId: "ONGC", confirmedBy: ["alice"] });
    links = mergeLink(links, { codeA: "NMC-A", codeB: "NMC-B", decision, cpseId: "SAIL", confirmedBy: ["bob"] });
    expect(links).toHaveLength(1);
    expect(links[0].id).toBe(linkId("NMC-A", "NMC-B"));
    expect([links[0].codeA, links[0].codeB]).toEqual(["NMC-A", "NMC-B"]);
    expect(links[0].cpseIds).toEqual(["ONGC", "SAIL"]);
    expect(links[0].confirmedBy).toEqual(["alice", "bob"]);
  });

  it("never links a code to itself", () => {
    expect(mergeLink([], { codeA: "NMC-A", codeB: "NMC-A", decision, cpseId: "ONGC", confirmedBy: ["a"] })).toEqual([]);
  });
});
