import { parseNumber } from "../src/lib/parse";
import { describe, it, expect } from "vitest";
import { parseCpseFile } from "../src/lib/parse";

function csvFile(name: string, content: string): File {
  return new File([content], name, { type: "text/csv" });
}

describe("parseCpseFile", () => {
  it("parses a file with recognizable SAP-style headers", async () => {
    const file = csvFile(
      "ongc.csv",
      "MATNR,MAKTX,MEINS\nONGC-FAS-0093,HEX NUT M12 SS304 DIN 934,NOS\n"
    );
    const { materials } = await parseCpseFile(file, "ONGC");
    expect(materials).toHaveLength(1);
    expect(materials[0].ownCode).toBe("ONGC-FAS-0093");
    expect(materials[0].uom).toBe("NOS");
    expect(materials[0].subtype).toBe("HNT");
  });

  it("parses a file with everyday (non-SAP) header names", async () => {
    const file = csvFile(
      "sail.csv",
      "Material Code,Material Description,Unit\nSAIL-NUT-0087,Nut Hexagon M12 Stainless Steel 304 DIN934 STD,EA\n"
    );
    const { materials } = await parseCpseFile(file, "SAIL");
    expect(materials[0].ownCode).toBe("SAIL-NUT-0087");
    expect(materials[0].subtype).toBe("HNT");
  });

  it("handles a HEADERLESS file via content-shape detection", async () => {
    const file = csvFile(
      "headerless.csv",
      "BHEL-0001,HEX NUT M16 SS316 ISO 4032,NOS\nBHEL-0002,HEX BOLT M12 X 50 SS304,NOS\n"
    );
    const { materials } = await parseCpseFile(file, "BHEL");
    expect(materials).toHaveLength(2);
    // Should NOT have swallowed row 1 as a header — both data rows present,
    // and roles resolved purely from content.
    expect(materials[0].ownCode).toBe("BHEL-0001");
    expect(materials[0].subtype).toBe("HNT");
    expect(materials[1].subtype).toBe("BLT");
  });

  it("detects a mixed multi-CPSE file via an organization column, overriding the fallback tag", async () => {
    const file = csvFile(
      "mixed.csv",
      "Organization,Material Code,Description,UOM\n" +
        "ONGC,ONGC-1,HEX NUT M12 SS304 DIN934,NOS\n" +
        "SAIL,SAIL-1,HEX NUT M16 SS316 ISO4032,NOS\n" +
        "BHEL,BHEL-1,GATE VALVE 4 INCH CLASS 300 WCB,NOS\n"
    );
    const { materials } = await parseCpseFile(file, "UNKNOWN_FALLBACK");
    expect(materials.map((m) => m.cpseId)).toEqual(["ONGC", "SAIL", "BHEL"]);
  });

  it("falls back to the file-level CPSE tag when no organization column exists", async () => {
    const file = csvFile("single.csv", "Code,Description,UOM\nX-1,HEX NUT M12 SS304 DIN934,NOS\n");
    const { materials } = await parseCpseFile(file, "CPCL");
    expect(materials[0].cpseId).toBe("CPCL");
  });

  it("skips rows with an empty description rather than crashing", async () => {
    const file = csvFile(
      "gaps.csv",
      "Code,Description,UOM\nX-1,HEX NUT M12 SS304 DIN934,NOS\nX-2,,NOS\n"
    );
    const { materials, skippedEmptyRows } = await parseCpseFile(file, "CPCL");
    expect(materials).toHaveLength(1);
    expect(skippedEmptyRows).toBe(1);
  });
});

describe("parseNumber", () => {
  it("handles Western and Indian grouping, currency markers and accounting negatives", () => {
    expect(parseNumber("1,234.50")).toBe(1234.5);
    expect(parseNumber("1,25,000")).toBe(125000);
    expect(parseNumber("₹ 1,250.50")).toBe(1250.5);
    expect(parseNumber("Rs. 1200")).toBe(1200);
    expect(parseNumber("INR 99")).toBe(99);
    expect(parseNumber("$3.5")).toBe(3.5);
    expect(parseNumber("(1,200)")).toBe(-1200);
    expect(parseNumber("-7")).toBe(-7);
    expect(parseNumber(42)).toBe(42);
  });
  it("REGRESSION: never truncates at a comma (parseFloat('1,234.50') returned 1)", () => {
    expect(parseFloat("1,234.50")).toBe(1);
    expect(parseNumber("1,234.50")).not.toBe(1);
  });
  it("returns NaN for non-numeric or ambiguous text instead of guessing", () => {
    for (const bad of ["", "abc", "12abc", "1,2", "1.2.3", "N/A", "12 NOS"]) expect(parseNumber(bad)).toBeNaN();
  });
});
