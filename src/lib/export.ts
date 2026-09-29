import type { MappingEntry, PipelineResult, SubstitutionLink } from "./types";
import type { EconomicsSummary } from "./economics";

// CSV builders for the deliverables a CPSE actually needs to act on the
// results: the legacy -> national code migration mapping (importable back
// into SAP), the validated-substitution reference table, and the economics
// roll-up. Pure functions (no DOM) so they're unit-testable; the only DOM
// code is downloadTextFile at the bottom.

/** Cells beginning with these are interpreted as formulas by Excel/Sheets
 * (CSV injection) — descriptions come from uploaded files, so neutralise. */
const FORMULA_LEADERS = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Only strings are guarded: real numbers (e.g. a negative quantity) must
  // stay numeric, but any text from an uploaded file could carry a formula.
  if (typeof value === "string" && FORMULA_LEADERS.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][], bom = false): string {
  const lines = [header.map((h) => csvCell(h)).join(","), ...rows.map((r) => r.map((c) => csvCell(c)).join(","))];
  return (bom ? "\uFEFF" : "") + lines.join("\r\n") + "\r\n";
}

export type MigrationStatus = "READY" | "REVIEW_PENDING";

export function migrationStatus(e: MappingEntry): MigrationStatus {
  return e.status === "pending-review" ? "REVIEW_PENDING" : "READY";
}

export interface MappingCsvOptions {
  cpseId?: string; // restrict to one CPSE (each CPSE imports its own rows)
  includePending?: boolean; // default true; false = only rows safe to import now
}

/**
 * Legacy material code -> national code mapping. `NEW_NMC_CODE` is the code
 * currently in force (follows supersession). Column names follow SAP field
 * conventions (MATNR / MEINS) so the file can drive a migration directly.
 */
export function mappingCsv(result: PipelineResult, opts: MappingCsvOptions = {}): string {
  const includePending = opts.includePending ?? true;
  const materialById = new Map(result.materials.map((x) => [x.id, x]));
  const rows = result.mapping
    .filter((e) => (!opts.cpseId || e.cpseId === opts.cpseId) && (includePending || e.status !== "pending-review"))
    .map((e) => {
      const m = materialById.get(e.materialId);
      return [
        e.cpseId,
        e.ownCode, // legacy MATNR
        e.description,
        e.uom,
        e.currentNmcCode ?? e.nmcCode, // new national code in force
        e.currentNmcCode ? e.nmcCode : "", // code originally issued, when since superseded
        migrationStatus(e),
        e.status,
        e.decision.verdict,
        Number(e.decision.confidence.toFixed(3)),
        e.decision.safetyRisk ?? "",
        e.decision.stage,
        e.linkedNmcCode ?? "",
        e.decision.matchedNmcCode ?? "",
        (e.reviewedBy ?? []).join("; "),
        e.reviewedAt ?? "",
        m?.quantity ?? "",
        m?.unitPrice ?? "",
        e.decision.reasons.join(" | "),
      ];
    });
  return toCsv(
    [
      "CPSE", "LEGACY_MATNR", "DESCRIPTION", "MEINS", "NEW_NMC_CODE", "ORIGINALLY_ISSUED_NMC_CODE",
      "MIGRATION_STATUS", "REVIEW_STATUS", "VERDICT", "CONFIDENCE", "SAFETY_RISK", "DECIDED_BY_STAGE",
      "VALIDATED_SUBSTITUTE_NMC_CODE", "MATCHED_NMC_CODE", "REVIEWED_BY", "REVIEWED_AT", "QUANTITY", "UNIT_PRICE", "REASONS",
    ],
    rows,
    true
  );
}

export function substitutionsCsv(links: SubstitutionLink[]): string {
  return toCsv(
    ["NMC_CODE_A", "NMC_CODE_B", "VERDICT", "SAFETY_RISK", "CONFIDENCE", "EVIDENCED_BY_CPSES", "CONFIRMED_BY", "CONFIRMED_AT", "AUDIT_SEQ", "REASONS"],
    links.map((l) => [
      l.codeA, l.codeB, l.verdict, l.safetyRisk ?? "", Number(l.confidence.toFixed(3)),
      l.cpseIds.join("; "), l.confirmedBy.join("; "), l.confirmedAt, l.auditSeq ?? "", l.reasons.join(" | "),
    ]),
    true
  );
}

export function economicsCsv(s: EconomicsSummary): string {
  return toCsv(
    ["NMC_CODE", "LEGACY_CODES", "CPSES", "UOM", "COMBINED_QUANTITY", "MIN_UNIT_PRICE", "MAX_UNIT_PRICE", "WEIGHTED_AVG_UNIT_PRICE", "VALUE", "PRICE_HARMONISATION_SAVINGS", "PRICED_ROWS"],
    s.perCode.map((c) => [
      c.nmcCode, c.legacyCodes, c.cpses.join("; "), c.uom, c.totalQuantity ?? "", c.minPrice ?? "", c.maxPrice ?? "",
      c.weightedAvgPrice ?? "", c.value, c.harmonizationSavings, c.pricedRows,
    ]),
    true
  );
}

export function downloadTextFile(filename: string, text: string, mime = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
