import { describe, it, expect } from "vitest";
import { buildNmcCode, isIdentityComplete, toNmcRecord } from "../src/lib/code";
import { extractAttributes } from "../src/lib/dictionary";
import type { ParsedMaterial } from "../src/lib/types";

function makeMaterial(desc: string, cpseId = "ONGC"): ParsedMaterial {
  const ex = extractAttributes(desc);
  return {
    id: `${cpseId}::test::1`,
    cpseId,
    sourceFile: "test.csv",
    rowNumber: 1,
    rawDescription: desc,
    ownCode: "X-1",
    uom: "NOS",
    quantity: null,
    unitPrice: null,
    category: ex.category,
    catCode: ex.catCode,
    subtype: ex.subtype,
    attrs: ex.attrs,
    corrosionClass: ex.corrosionClass,
    strengthRank: ex.strengthRank,
    classifiedBy: "rules",
  };
}

describe("NMC code generation", () => {
  it("two independently-worded but identical materials converge on the same code", () => {
    const a = makeMaterial("HEX NUT M12 SS304 DIN 934", "ONGC");
    const b = makeMaterial("Nut, Hexagon, M12, Stainless Steel 304, DIN934 STD", "SAIL");
    expect(buildNmcCode(a)).toBe(buildNmcCode(b));
  });

  it("different grade produces a different code even with the same dimensions", () => {
    const a = makeMaterial("HEX NUT M12 SS304 DIN934");
    const b = makeMaterial("HEX NUT M12 MS ZINC PLATED DIN934");
    expect(buildNmcCode(a)).not.toBe(buildNmcCode(b));
  });

  it("REGRESSION: two unrelated uncategorized items no longer collide (old bug)", () => {
    const a = makeMaterial("MISCELLANEOUS OFFICE STATIONERY STAPLER");
    const b = makeMaterial("MISCELLANEOUS CANTEEN CROCKERY SET");
    expect(a.subtype).toBe("UNK");
    expect(b.subtype).toBe("UNK");
    expect(buildNmcCode(a)).not.toBe(buildNmcCode(b));
  });

  it("two IDENTICAL uncategorized descriptions still converge (content hash, not random)", () => {
    const a = makeMaterial("MISCELLANEOUS OFFICE STATIONERY STAPLER", "ONGC");
    const b = makeMaterial("STAPLER MISCELLANEOUS OFFICE STATIONERY", "SAIL"); // reordered
    expect(buildNmcCode(a)).toBe(buildNmcCode(b));
  });

  it("REGRESSION: two hex nuts with unparsed thread size no longer collide as bare NMC-FAS-HNT", () => {
    const a = makeMaterial("HEX NUT SPECIAL SIZE SS304"); // no thread parsed
    const b = makeMaterial("HEX NUT ANOTHER VARIANT SS316");
    expect(isIdentityComplete(a)).toBe(false);
    expect(isIdentityComplete(b)).toBe(false);
    expect(buildNmcCode(a)).not.toBe(buildNmcCode(b));
    expect(buildNmcCode(a)).not.toBe("NMC-FAS-HNT");
  });

  it("complete records are marked complete; incomplete ones are not", () => {
    const complete = makeMaterial("HEX NUT M12 SS304 DIN934");
    const incomplete = makeMaterial("HEX NUT SOME VARIANT SS304");
    expect(toNmcRecord(complete).complete).toBe(true);
    expect(toNmcRecord(incomplete).complete).toBe(false);
  });
});
