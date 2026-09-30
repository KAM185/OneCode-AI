import { describe, it, expect, vi } from "vitest";

// The embedding model requires network access to download weights, which is
// unavailable in this test sandbox (and shouldn't be a CI dependency
// anyway). Mocking it here deterministically exercises match.ts's fallback
// path — the exact path a real air-gapped/offline deployment also takes.
vi.mock("../src/lib/embeddings", () => ({
  getEmbedderStatus: () => "unavailable",
  embedSimilarity: async () => null,
}));

const { decidePair, computeSafetyRisk } = await import("../src/lib/match");
const { extractAttributes } = await import("../src/lib/dictionary");
import type { ParsedMaterial, Rank } from "../src/lib/types";

function make(desc: string, cpseId = "ONGC"): ParsedMaterial {
  const ex = extractAttributes(desc);
  return {
    id: `${cpseId}::${desc}`, cpseId, sourceFile: "t.csv", rowNumber: 1, rawDescription: desc,
    ownCode: "X", uom: "NOS", quantity: null, unitPrice: null,
    category: ex.category, catCode: ex.catCode, subtype: ex.subtype, attrs: ex.attrs,
    corrosionClass: ex.corrosionClass, strengthRank: ex.strengthRank, classifiedBy: "rules",
  };
}

describe("decidePair — rule cascade", () => {
  it("identical materials worded differently => duplicate, auto (no review)", async () => {
    const a = make("HEX NUT M12 SS304 DIN 934");
    const b = make("Nut, Hexagon, M12, Stainless Steel 304, DIN934 STD");
    const d = await decidePair(a, b);
    expect(d.verdict).toBe("duplicate");
    expect(d.needsReview).toBe(false);
  });

  it("same size, different grade with matching corrosion class => functionally_equivalent, ALWAYS needs review", async () => {
    const a = make("HEX NUT M12 SS304 DIN934");
    const b = make("HEX NUT M12 SS316 DIN934");
    const d = await decidePair(a, b);
    expect(d.verdict).toBe("functionally_equivalent");
    expect(d.needsReview).toBe(true); // never silently auto-merged
  });

  it("same size, grade downgrade (high corrosion -> low) on a pressure-bearing part => HIGH safety risk, forced review", async () => {
    const a = make("HEX NUT M12 SS304 DIN934");
    const b = make("HEX NUT M12 MS DIN934"); // mild steel, no zinc: LOW corrosion
    const d = await decidePair(a, b);
    expect(d.safetyRisk).toBe("HIGH");
    expect(d.needsReview).toBe(true);
    expect(d.verdict).not.toBe("duplicate");
  });

  it("different thread size => distinct regardless of matching grade (dimensions gate everything)", async () => {
    const a = make("HEX NUT M12 SS304 DIN934");
    const b = make("HEX NUT M16 SS304 DIN934");
    const d = await decidePair(a, b);
    expect(d.verdict).toBe("distinct");
    expect(d.needsReview).toBe(false);
  });

  it("dimensionally-equivalent standards (DIN934/ISO4032) => similar, not silently merged", async () => {
    const a = make("HEX NUT M12 SS304 DIN934");
    const b = make("HEX NUT M12 SS304 ISO4032");
    const d = await decidePair(a, b);
    expect(d.verdict).toBe("similar");
    expect(d.needsReview).toBe(true);
  });

  it("different category entirely => distinct", async () => {
    const a = make("HEX NUT M12 SS304 DIN934");
    const b = make("GATE VALVE 4 INCH CLASS 300 WCB");
    const d = await decidePair(a, b);
    expect(d.verdict).toBe("distinct");
  });
});

describe("computeSafetyRisk", () => {
  const rank = (r: Rank | null) => r;
  it("LOW risk when corrosion classes match", () => {
    const a = make("HEX NUT M12 SS304 DIN934");
    const b = make("HEX NUT M12 SS316 DIN934");
    expect(rank(computeSafetyRisk(a, b, true))).toBe("LOW");
  });
  it("HIGH risk for a two-step corrosion downgrade on a pressure-bearing part", () => {
    const a = make("HEX NUT M12 SS304 DIN934"); // HIGH
    const b = make("HEX NUT M12 MS DIN934"); // LOW
    expect(rank(computeSafetyRisk(a, b, true))).toBe("HIGH");
  });
  it("lower risk for the same downgrade on a non-pressure-bearing part", () => {
    const a = make("BALL BEARING 6205 SS304");
    const b = make("BALL BEARING 6205 MS");
    const r = computeSafetyRisk(a, b, false);
    expect(r === "MEDIUM" || r === "LOW").toBe(true);
  });
});
