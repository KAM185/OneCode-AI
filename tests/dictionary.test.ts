import { describe, it, expect } from "vitest";
import { extractAttributes, standardsEquivalent } from "../src/lib/dictionary";

describe("dictionary — subtype detection", () => {
  it("recognizes a hex nut and extracts thread/grade/standard", () => {
    const r = extractAttributes("HEX NUT M12 SS304 DIN 934");
    expect(r.subtype).toBe("HNT");
    expect(r.attrs.thread).toBe("M12");
    expect(r.attrs.grade).toBe("SS304");
    expect(r.attrs.standard).toBe("DIN934");
    expect(r.corrosionClass).toBe("HIGH");
  });

  it("handles very differently-worded but equivalent hex nut text", () => {
    const r = extractAttributes("Nut, Hexagon, M12, Stainless Steel 304, DIN934 STD");
    expect(r.subtype).toBe("HNT");
    expect(r.attrs.thread).toBe("M12");
    expect(r.attrs.grade).toBe("SS304");
  });

  it("distinguishes mild-steel-zinc from stainless (medium vs high corrosion)", () => {
    const r = extractAttributes("HEX NUT M12 MS ZINC PLATED DIN934");
    expect(r.attrs.grade).toBe("MS");
    expect(r.attrs.finish).toBe("ZN");
    expect(r.corrosionClass).toBe("MEDIUM");
  });

  it("does not misfire a bolt as a nut, or vice versa", () => {
    expect(extractAttributes("HEX BOLT M12 X 50 SS304").subtype).toBe("BLT");
    expect(extractAttributes("HEX NUT M12 SS304").subtype).toBe("HNT");
  });

  it("does not classify a lock nut as a plain hex nut", () => {
    // exclude-list check: "lock nut" should not match plain HNT synonyms
    const r = extractAttributes("NYLOCK NUT M12 SS304");
    expect(r.subtype).not.toBe("HNT");
  });

  it("extracts flange size, pressure class and face type", () => {
    const r = extractAttributes("FLANGE WELD NECK 150MM CLASS 150 RF ASTM A105");
    expect(r.subtype).toBe("FLG");
    expect(r.attrs.size).toBe("DN150");
    expect(r.attrs.pressure).toBe("CL150");
    expect(r.attrs.flgType).toBe("WN");
    expect(r.attrs.face).toBe("RF");
    expect(r.attrs.grade).toBe("A105");
  });

  it("extracts valve type and end connection", () => {
    const r = extractAttributes('GATE VALVE 4 INCH CLASS 300 FLANGED WCB');
    expect(r.subtype).toBe("VLV");
    expect(r.attrs.valveType).toBe("GATE");
    expect(r.attrs.size).toBe("DN100");
    expect(r.attrs.pressure).toBe("CL300");
    expect(r.attrs.endConn).toBe("FLANGED");
  });

  it("extracts pipe schedule and size", () => {
    const r = extractAttributes("SEAMLESS PIPE 6 INCH SCH 40 A106 GR B");
    expect(r.subtype).toBe("PPE");
    expect(r.attrs.size).toBe("DN150");
    expect(r.attrs.schedule).toBe("SCH40");
    expect(r.attrs.pipeType).toBe("SMLS");
    expect(r.attrs.grade).toBe("A106B");
  });

  it("extracts motor power/voltage/poles/phase", () => {
    const r = extractAttributes("INDUCTION MOTOR 5 HP 415V 3 PHASE 4 POLE");
    expect(r.subtype).toBe("MTR");
    expect(r.attrs.power).toBe("3.7KW");
    expect(r.attrs.voltage).toBe("415V");
    expect(r.attrs.phase).toBe("3PH");
    expect(r.attrs.poles).toBe("4P");
  });

  it("extracts cable cores and cross-section", () => {
    const r = extractAttributes("XLPE POWER CABLE 3.5C X 95 SQMM COPPER");
    expect(r.subtype).toBe("CBL");
    expect(r.attrs.cores).toBe("3.5C");
    expect(r.attrs.csa).toBe("95SQMM");
    expect(r.attrs.conductor).toBe("CU");
    expect(r.attrs.insulation).toBe("XLPE");
  });

  it("extracts bearing number and seal type", () => {
    const r = extractAttributes("BALL BEARING 6205 2RS");
    expect(r.subtype).toBe("BRG");
    expect(r.attrs.bearingNo).toBe("6205");
    expect(r.attrs.seal).toBe("2RS");
  });

  it("extracts plate thickness and grade", () => {
    const r = extractAttributes("MS PLATE 10MM THICK IS 2062");
    expect(r.subtype).toBe("PLT");
    expect(r.attrs.thickness).toBe("10MM");
    expect(r.attrs.standard).toBe("IS2062");
  });

  it("extracts structural section", () => {
    const r = extractAttributes("ISMB 200 X 100 STRUCTURAL BEAM IS 2062");
    expect(r.subtype).toBe("STR");
    expect(r.attrs.section).toBe("ISMB200X100");
  });

  it("extracts gauge range and dial size", () => {
    const r = extractAttributes("PRESSURE GAUGE 0-100 BAR 100MM DIAL");
    expect(r.subtype).toBe("GAG");
    expect(r.attrs.range).toBe("0-100BAR");
    expect(r.attrs.dial).toBe("DIAL100");
  });

  it("extracts lubricant viscosity grade", () => {
    const r = extractAttributes("HYDRAULIC OIL ISO VG 46");
    expect(r.subtype).toBe("LUB");
    expect(r.attrs.lubType).toBe("HYD");
    expect(r.attrs.viscosity).toBe("VG46");
  });

  it("falls back to Uncategorized for genuinely unknown text", () => {
    const r = extractAttributes("MISCELLANEOUS OFFICE STATIONERY ITEM XYZ");
    expect(r.subtype).toBe("UNK");
    expect(r.category).toBe("Uncategorized");
  });
});

describe("dictionary — standard equivalence", () => {
  it("treats DIN934/ISO4032 as dimensionally equivalent", () => {
    expect(standardsEquivalent("DIN934", "ISO4032")).toBe(true);
  });
  it("does not treat unrelated standards as equivalent", () => {
    expect(standardsEquivalent("DIN934", "A105")).toBe(false);
  });
});

describe("thread size extraction — regression", () => {
  it("REGRESSION: M100/M150 are not silently truncated to M10/M15 (which merged different sizes)", () => {
    expect(extractAttributes("HEX NUT M100 SS304 DIN934").attrs.thread).toBe("M100");
    expect(extractAttributes("HEX NUT M150 SS304 DIN934").attrs.thread).toBe("M150");
    expect(extractAttributes("HEX NUT M10 SS304 DIN934").attrs.thread).toBe("M10");
    expect(extractAttributes("HEX NUT M100 SS304 DIN934").attrs.thread).not.toBe(extractAttributes("HEX NUT M10 SS304 DIN934").attrs.thread);
  });
  it("still parses ordinary sizes and lengths", () => {
    const a = extractAttributes("HEX BOLT M12X150 SS304 DIN933").attrs;
    expect(a.thread).toBe("M12");
    expect(a.length).toBe("150MM");
    expect(extractAttributes("HEX BOLT M8X1.25X40 SS304").attrs.thread).toBe("M8");
  });
});
