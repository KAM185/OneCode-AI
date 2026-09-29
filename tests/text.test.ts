import { describe, it, expect } from "vitest";
import { jaccard, contentTokens, trigramCosine, tokenKey, shortHash, numericMismatch } from "../src/lib/text";

describe("text utilities", () => {
  it("jaccard treats reordered tokens as identical", () => {
    const a = contentTokens("HEX NUT M12 SS304");
    const b = contentTokens("SS304 M12 NUT HEX");
    expect(jaccard(a, b)).toBe(1);
  });

  it("trigramCosine is robust to minor typos", () => {
    const sim = trigramCosine("HEXAGONAL NUT M12", "HEXAGNOAL NUT M12");
    expect(sim).toBeGreaterThan(0.7);
  });

  it("tokenKey is order-insensitive (needed for stable content hashing)", () => {
    expect(tokenKey("Nut Hexagon M12")).toBe(tokenKey("M12 Hexagon Nut"));
  });

  it("shortHash is deterministic and collision-free for distinct inputs", () => {
    const h1 = shortHash("hello world");
    const h2 = shortHash("hello world");
    const h3 = shortHash("goodbye world");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toHaveLength(8);
  });

  it("numericMismatch flags clearly different sizes", () => {
    expect(numericMismatch(["M12"], ["M16"])).toBe(true);
    expect(numericMismatch(["M12"], ["M12"])).toBe(false);
  });
});
