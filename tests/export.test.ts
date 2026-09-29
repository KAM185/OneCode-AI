import { describe, it, expect, vi } from "vitest";
import Papa from "papaparse";
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
const { csvCell, toCsv, mappingCsv, substitutionsCsv, economicsCsv } = await import("../src/lib/export");
const { computeEconomics } = await import("../src/lib/economics");
const { applyReview } = await import("../src/lib/review");
const { applySupersessions } = await import("../src/lib/registry");

const parse = (csv: string) => Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ""), { header: true, skipEmptyLines: true });

async function scenario() {
  return runPipeline([
    {
      file: csvFile("m.csv", "Organization,Code,Description,UOM,Qty,Unit Price\nONGC,O-1,\"HEX NUT M12 SS304 DIN934, ZINC\",NOS,100,10\nSAIL,S-1,HEX NUT M12 SS316 DIN934,NOS,50,12\nSAIL,S-2,GATE VALVE 4 INCH CLASS 300 WCB,NOS,2,5000\n"),
      cpseId: "X",
    },
  ]);
}

describe("CSV primitives", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
  });
  it("neutralises spreadsheet formula injection in text but leaves real numbers alone", () => {
    for (const evil of ["=HYPERLINK(\"x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd"]) expect(csvCell(evil).replace(/^"/, "")).toMatch(/^'/);
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(12.5)).toBe("12.5");
  });
  it("round-trips through a real CSV parser, BOM optional", () => {
    const csv = toCsv(["A", "B"], [["x,y", 'q"r'], ["=bad", 3]], true);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const rows = parse(csv).data;
    expect(rows[0]).toEqual({ A: "x,y", B: 'q"r' });
    expect(rows[1].A).toBe("'=bad");
  });
});

describe("migration mapping export (legacy -> national code)", () => {
  it("emits one row per legacy item with the SAP-style columns, parseable back", async () => {
    const r = await scenario();
    const { data, meta } = parse(mappingCsv(r));
    expect(data).toHaveLength(3);
    expect(meta.fields).toEqual(expect.arrayContaining(["CPSE", "LEGACY_MATNR", "MEINS", "NEW_NMC_CODE", "MIGRATION_STATUS"]));
    expect(data[0].LEGACY_MATNR).toBe("O-1");
    expect(data[0].DESCRIPTION).toBe("HEX NUT M12 SS304 DIN934, ZINC"); // comma survived
    expect(data[0].NEW_NMC_CODE).toBe(r.mapping[0].nmcCode);
    expect(data[0].QUANTITY).toBe("100");
    expect(data.map((d) => d.NEW_NMC_CODE)).toEqual(r.mapping.map((m) => m.nmcCode));
  });

  it("filters per CPSE and can exclude items still pending review", async () => {
    const r = await scenario();
    expect(parse(mappingCsv(r, { cpseId: "SAIL" })).data).toHaveLength(2);
    const pendingCount = r.mapping.filter((m) => m.status === "pending-review").length;
    expect(pendingCount).toBeGreaterThan(0);
    const ready = parse(mappingCsv(r, { includePending: false })).data;
    expect(ready).toHaveLength(3 - pendingCount);
    expect(ready.every((d) => d.MIGRATION_STATUS === "READY")).toBe(true);
    const all = parse(mappingCsv(r)).data;
    expect(all.filter((d) => d.MIGRATION_STATUS === "REVIEW_PENDING")).toHaveLength(pendingCount);
  });

  it("uses the code in force after supersession and keeps the originally-issued code visible", async () => {
    const r = await scenario();
    const old = r.mapping[2].nmcCode;
    const after = applySupersessions(r, { [old]: { oldCode: old, newCode: "NMC-REPLACEMENT", reason: "r", by: ["a"], at: "" } });
    const row = parse(mappingCsv(after)).data[2];
    expect(row.NEW_NMC_CODE).toBe("NMC-REPLACEMENT");
    expect(row.ORIGINALLY_ISSUED_NMC_CODE).toBe(old);
  });

  it("carries review outcome and validated substitute", async () => {
    const r = await scenario();
    const pend = r.mapping.find((m) => m.status === "pending-review")!;
    const { result } = applyReview(r, pend, "confirmed", ["alice", "bob"], {}, 1);
    const row = parse(mappingCsv(result)).data.find((d) => d.LEGACY_MATNR === pend.ownCode)!;
    expect(row.REVIEW_STATUS).toBe("reviewed-confirmed");
    expect(row.REVIEWED_BY).toBe("alice; bob");
    expect(row.VALIDATED_SUBSTITUTE_NMC_CODE).toBe(pend.decision.matchedNmcCode);
    expect(row.MIGRATION_STATUS).toBe("READY");
  });

  it("neutralises a formula-looking description from an uploaded file", async () => {
    const r = await runPipeline([{ file: csvFile("e.csv", 'Code,Description,UOM\nX-1,"=cmd|\' /C calc\'!A0 HEX NUT M12 SS304",NOS\n'), cpseId: "X" }]);
    expect(parse(mappingCsv(r)).data[0].DESCRIPTION.startsWith("'=")).toBe(true);
  });
});

describe("other exports", () => {
  it("substitution table and economics CSVs parse and carry the numbers", async () => {
    expect(parse(substitutionsCsv([{ id: "A<->B", codeA: "A", codeB: "B", verdict: "functionally_equivalent", safetyRisk: "LOW", confidence: 0.75, reasons: ["x", "y"], cpseIds: ["ONGC", "SAIL"], confirmedBy: ["alice"], confirmedAt: "t", auditSeq: 4 }])).data[0])
      .toMatchObject({ NMC_CODE_A: "A", NMC_CODE_B: "B", EVIDENCED_BY_CPSES: "ONGC; SAIL", AUDIT_SEQ: "4", REASONS: "x | y" });
    const r = await scenario();
    const rows = parse(economicsCsv(computeEconomics(r.mapping, r.materials))).data;
    expect(rows).toHaveLength(new Set(r.mapping.map((m) => m.nmcCode)).size);
    expect(Number(rows.find((x) => x.NMC_CODE === r.mapping[0].nmcCode)!.VALUE)).toBe(1000);
  });
});
