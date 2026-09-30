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
const reg = await import("../src/lib/registry");
const { applyReview } = await import("../src/lib/review");

const run = (rows: string[], supersessions?: reg.SupersessionMap) =>
  runPipeline([{ file: csvFile("t.csv", `Code,Description,UOM\n${rows.map((r, i) => `C-${i + 1},${r},NOS`).join("\n")}\n`), cpseId: "ONGC" }], undefined, { supersessions });

const base = (o: Partial<Parameters<typeof reg.addSupersession>[1]> = {}) => ({ oldCode: "A", newCode: "B", reason: "spec change", by: ["alice"], ...o });

describe("supersession registry — validation", () => {
  it("records a supersession with who/when/why", () => {
    const m = reg.addSupersession({}, base({ auditSeq: 3, at: "2026-09-29T00:00:00Z" }));
    expect(m.A).toEqual({ oldCode: "A", newCode: "B", reason: "spec change", by: ["alice"], at: "2026-09-29T00:00:00Z", auditSeq: 3 });
  });
  it("rejects self-supersession, missing reason, unknown codes, and re-superseding", () => {
    expect(() => reg.addSupersession({}, base({ newCode: "A" }))).toThrow(/itself/);
    expect(() => reg.addSupersession({}, base({ reason: " " }))).toThrow(/reason/);
    expect(() => reg.addSupersession({}, base(), new Set(["A"]))).toThrow(/Unknown replacement/);
    expect(() => reg.addSupersession({}, base(), new Set(["B"]))).toThrow(/Unknown code/);
    const m = reg.addSupersession({}, base());
    expect(() => reg.addSupersession(m, base({ newCode: "C" }))).toThrow(/already superseded by B/);
  });
  it("rejects direct and indirect cycles", () => {
    const m = reg.addSupersession(reg.addSupersession({}, base({ oldCode: "A", newCode: "B" })), base({ oldCode: "B", newCode: "C" }));
    expect(() => reg.addSupersession(m, base({ oldCode: "C", newCode: "A" }))).toThrow(/cycle/);
    expect(() => reg.addSupersession(reg.addSupersession({}, base({ oldCode: "A", newCode: "B" })), base({ oldCode: "B", newCode: "A" }))).toThrow(/cycle/);
  });
  it("resolves multi-hop chains to the code in force, and survives a corrupt cyclic map", () => {
    const m = { A: { oldCode: "A", newCode: "B" }, B: { oldCode: "B", newCode: "C" } } as reg.SupersessionMap;
    expect(reg.resolveCurrentCode("A", m)).toBe("C");
    expect(reg.resolveCurrentCode("C", m)).toBe("C");
    expect(reg.resolveCurrentCode("Z", m)).toBe("Z");
    const cyc = { A: { oldCode: "A", newCode: "B" }, B: { oldCode: "B", newCode: "A" } } as reg.SupersessionMap;
    expect(["A", "B"]).toContain(reg.resolveCurrentCode("A", cyc)); // terminates
  });
});

describe("supersession is a real feature, not a schema field", () => {
  it("sets NmcRecord.supersededBy and redirects mapping rows via currentNmcCode (nmcCode itself is never rewritten)", async () => {
    const r = await run(["HEX NUT M12 SS304 DIN934", "GATE VALVE 4 INCH CLASS 300 WCB"]);
    const [old, replacement] = r.records.map((x) => x.nmcCode);
    expect(r.records.every((x) => x.supersededBy === null)).toBe(true);

    const map = reg.addSupersession({}, { oldCode: old, newCode: replacement, reason: "consolidated", by: ["alice"] }, new Set(r.records.map((x) => x.nmcCode)));
    const after = reg.applySupersessions(r, map);
    expect(after.records.find((x) => x.nmcCode === old)!.supersededBy).toBe(replacement);
    expect(after.records.find((x) => x.nmcCode === replacement)!.supersededBy).toBeNull();
    const row = after.mapping.find((m) => m.nmcCode === old)!;
    expect(row.nmcCode).toBe(old);
    expect(row.currentNmcCode).toBe(replacement);
    expect(after.mapping.find((m) => m.nmcCode === replacement)!.currentNmcCode).toBeUndefined();
  });

  it("a later run applies the registry automatically", async () => {
    const first = await run(["HEX NUT M12 SS304 DIN934"]);
    const code = first.mapping[0].nmcCode;
    const map = reg.addSupersession({}, { oldCode: code, newCode: "NMC-FAS-HNT-M12-SS316-DIN934", reason: "upgrade to 316", by: ["alice"] });
    const second = await run(["HEX NUT M12 SS304 DIN934"], map);
    expect(second.mapping[0].currentNmcCode).toBe("NMC-FAS-HNT-M12-SS316-DIN934");
    expect(second.records[0].supersededBy).toBe("NMC-FAS-HNT-M12-SS316-DIN934");
  });

  it("clearing the registry removes the redirect (applySupersessions is a pure re-derivation)", async () => {
    const r = await run(["HEX NUT M12 SS304 DIN934"]);
    const code = r.mapping[0].nmcCode;
    const redirected = reg.applySupersessions(r, reg.addSupersession({}, { oldCode: code, newCode: "X-NEW", reason: "why", by: ["a"] }));
    expect(redirected.mapping[0].currentNmcCode).toBe("X-NEW");
    expect(reg.applySupersessions(redirected, {}).mapping[0].currentNmcCode).toBeUndefined();
  });

  it("a review resolved AFTER a supersession still points at the code in force", async () => {
    const r = await run(["HEX NUT M12 SS304 DIN934", "HEX NUT M12 SS316 DIN934"]);
    const second = r.mapping[1];
    const map = reg.addSupersession({}, { oldCode: second.nmcCode, newCode: "NMC-NEW", reason: "why", by: ["a"] });
    const { result } = applyReview(r, second, "confirmed", ["a"], map);
    expect(result.mapping[1].currentNmcCode).toBe("NMC-NEW");
  });

  it("persists across sessions through storage", () => {
    reg.saveSupersessions(reg.addSupersession({}, base()));
    expect(reg.loadSupersessions().A.newCode).toBe("B");
    reg.saveSubstitutions([]);
    expect(reg.loadSubstitutions()).toEqual([]);
  });
});

describe("link members (cross-CPSE view)", () => {
  it("persists both sides and merges without duplicating", async () => {
    const { mergeLink } = await import("../src/lib/registry");
    const d = { verdict: "functionally_equivalent" as const, safetyRisk: "LOW" as const, confidence: 0.75, reasons: ["r"] };
    const a = { cpseId: "A", ownCode: "1", description: "x", nmcCode: "N1" };
    const b = { cpseId: "B", ownCode: "2", description: "y", nmcCode: "N2" };
    let links = mergeLink([], { codeA: "N1", codeB: "N2", decision: d, cpseId: "A", members: [a, b], confirmedBy: ["r1"] });
    links = mergeLink(links, { codeA: "N2", codeB: "N1", decision: d, cpseId: "B", members: [a, b], confirmedBy: ["r2"] });
    expect(links).toHaveLength(1);
    expect(links[0].members).toHaveLength(2);
    expect(links[0].cpseIds.sort()).toEqual(["A", "B"]);
  });
});
