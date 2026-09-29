import type { MappingEntry, ParsedMaterial } from "./types";

// ---------------------------------------------------------------------------
// Quantified economic impact, computed from the quantity / unit-price columns
// the parser already extracts. Everything here is derived arithmetic on the
// uploaded data — no assumed carrying-cost percentages or market prices. The
// one estimate (price harmonisation) states its assumption explicitly.
// ---------------------------------------------------------------------------

/** Collapses common UOM spellings so "NOS" and "EA" aren't treated as
 * different units. Unknown units compare as themselves (uppercased). */
export function normalizeUom(uom: string): string {
  const u = uom.trim().toUpperCase();
  if (!u) return "";
  const groups: Record<string, string[]> = {
    EA: ["NOS", "NO", "EA", "EACH", "PC", "PCS", "UNIT"],
    M: ["M", "MTR", "METER", "METRE"],
    L: ["L", "LTR", "LITRE", "LITER"],
    MT: ["MT", "TON", "TONNE"],
  };
  for (const [canon, aliases] of Object.entries(groups)) if (aliases.includes(u)) return canon;
  return u;
}

export interface CodeEconomics {
  nmcCode: string;
  legacyCodes: number;
  cpses: string[];
  uom: string; // normalised, or "MIXED"
  totalQuantity: number | null; // null when UOMs are mixed or no quantities
  minPrice: number | null;
  maxPrice: number | null;
  weightedAvgPrice: number | null;
  value: number; // Σ qty × price over rows having both
  /** Σ qty × (price − lowest price seen for this code), rows with both. */
  harmonizationSavings: number;
  pricedRows: number;
}

export interface EconomicsSummary {
  entries: number;
  withQuantity: number;
  withPrice: number;
  withBoth: number;
  uniqueCodes: number;
  redundantCodesEliminated: number;
  catalogueReductionPct: number;
  multiCpseCodes: number;
  mixedUomCodes: number;
  totalValue: number;
  harmonizationSavings: number;
  savingsPctOfValue: number;
  perCode: CodeEconomics[];
  topSavings: CodeEconomics[];
  topCombinedDemand: CodeEconomics[]; // multi-CPSE codes, by combined quantity
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeEconomics(mapping: MappingEntry[], materials: ParsedMaterial[]): EconomicsSummary {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const groups = new Map<string, { entry: MappingEntry; m: ParsedMaterial | undefined }[]>();

  let withQuantity = 0, withPrice = 0, withBoth = 0;
  for (const entry of mapping) {
    const code = entry.currentNmcCode ?? entry.nmcCode;
    const m = byId.get(entry.materialId);
    if (m?.quantity != null && m.quantity > 0) withQuantity++;
    if (m?.unitPrice != null && m.unitPrice > 0) withPrice++;
    if (m?.quantity != null && m.quantity > 0 && m?.unitPrice != null && m.unitPrice > 0) withBoth++;
    (groups.get(code) ?? groups.set(code, []).get(code)!).push({ entry, m });
  }

  const perCode: CodeEconomics[] = [];
  for (const [nmcCode, rows] of groups) {
    const uoms = new Set(rows.map((r) => normalizeUom(r.entry.uom)).filter(Boolean));
    const uom = uoms.size > 1 ? "MIXED" : [...uoms][0] ?? "";
    const cpses = [...new Set(rows.map((r) => r.entry.cpseId))].sort();

    const qtyRows = rows.filter((r) => r.m?.quantity != null && r.m.quantity > 0);
    const totalQuantity = uom === "MIXED" || qtyRows.length === 0 ? null : qtyRows.reduce((s, r) => s + (r.m!.quantity as number), 0);

    // Price maths only where the unit is unambiguous — mixing "per EA" and
    // "per KG" prices would produce meaningless savings.
    const priced = uom === "MIXED" ? [] : rows.filter((r) => r.m?.quantity != null && r.m.quantity > 0 && r.m?.unitPrice != null && r.m.unitPrice > 0);
    let minPrice: number | null = null, maxPrice: number | null = null, weightedAvgPrice: number | null = null;
    let value = 0, savings = 0;
    if (priced.length > 0) {
      const prices = priced.map((r) => r.m!.unitPrice as number);
      minPrice = Math.min(...prices);
      maxPrice = Math.max(...prices);
      let qSum = 0;
      for (const r of priced) {
        const q = r.m!.quantity as number, p = r.m!.unitPrice as number;
        value += q * p;
        qSum += q;
        savings += q * (p - minPrice);
      }
      weightedAvgPrice = value / qSum;
    }

    perCode.push({
      nmcCode,
      legacyCodes: rows.length,
      cpses,
      uom,
      totalQuantity,
      minPrice,
      maxPrice,
      weightedAvgPrice: weightedAvgPrice === null ? null : round2(weightedAvgPrice),
      value: round2(value),
      // A single priced row has nothing to harmonise against.
      harmonizationSavings: priced.length >= 2 ? round2(savings) : 0,
      pricedRows: priced.length,
    });
  }

  const totalValue = round2(perCode.reduce((s, c) => s + c.value, 0));
  const harmonizationSavings = round2(perCode.reduce((s, c) => s + c.harmonizationSavings, 0));
  const uniqueCodes = perCode.length;
  const redundant = Math.max(0, mapping.length - uniqueCodes);

  return {
    entries: mapping.length,
    withQuantity,
    withPrice,
    withBoth,
    uniqueCodes,
    redundantCodesEliminated: redundant,
    catalogueReductionPct: mapping.length === 0 ? 0 : Math.round((redundant / mapping.length) * 1000) / 10,
    multiCpseCodes: perCode.filter((c) => c.cpses.length > 1).length,
    mixedUomCodes: perCode.filter((c) => c.uom === "MIXED").length,
    totalValue,
    harmonizationSavings,
    savingsPctOfValue: totalValue === 0 ? 0 : Math.round((harmonizationSavings / totalValue) * 1000) / 10,
    perCode,
    topSavings: perCode.filter((c) => c.harmonizationSavings > 0).sort((a, b) => b.harmonizationSavings - a.harmonizationSavings).slice(0, 10),
    topCombinedDemand: perCode
      .filter((c) => c.cpses.length > 1 && c.totalQuantity !== null)
      .sort((a, b) => (b.totalQuantity as number) - (a.totalQuantity as number))
      .slice(0, 10),
  };
}
