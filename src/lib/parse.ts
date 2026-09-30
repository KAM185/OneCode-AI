import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { ParsedMaterial } from "./types";
import { extractAttributes } from "./dictionary";
import { CPSE_LIST, COMMON_UOMS } from "./constants";

// ---------------------------------------------------------------------------
// Stage 0a — ingestion. CSV, Excel, and SAP-style flat exports all converge
// to a plain grid of strings before any header assumptions are made.
// ---------------------------------------------------------------------------

export class ParseError extends Error {}
const MAX_BYTES = 25 * 1024 * 1024;

async function readFileToGrid(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false });
    return rows.map((r) => r.map((c) => String(c ?? "")));
  }
  const text = await file.text();
  return Papa.parse<string[]>(text, { header: false, skipEmptyLines: true }).data as string[][];
}

// ---------------------------------------------------------------------------
// Stage 0b — header detection: compares the shape of row 1 vs row 2 (which
// cells are numeric vs text). Identical shape => row 1 is data, not a
// header.
// ---------------------------------------------------------------------------

function cellShape(cell: string): "N" | "T" | "E" {
  const c = cell.trim();
  if (c === "") return "E";
  return /\d/.test(c) ? "N" : "T";
}
function rowSignature(row: string[]): string {
  return row.map(cellShape).join("");
}
function looksLikeHeaderRow(row: string[], nextRow: string[] | undefined): boolean {
  if (!nextRow || nextRow.length === 0) return true;
  if (row.length === nextRow.length) {
    const s0 = rowSignature(row);
    const s1 = rowSignature(nextRow);
    if (s0 === s1 && s0.includes("N")) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Stage 0c — column role resolution. Each column is scored for how well it
// fits each required role using BOTH header name (when recognizable) and
// content shape (works even with missing/unfamiliar headers). One formula
// covers named headers, unrecognized SAP field codes, mixed multi-CPSE
// files, and fully headerless dumps.
// ---------------------------------------------------------------------------

type Role = "ownCode" | "description" | "uom" | "cpseId" | "quantity" | "unitPrice";

const NAME_ALIASES: Record<Role, string[]> = {
  ownCode: ["matnr", "material code", "material number", "code", "item code", "sap code", "material_code", "part no", "part number"],
  description: ["maktx", "description", "material description", "desc", "item description", "material_desc", "item name"],
  uom: ["meins", "uom", "unit", "unit of measure", "base uom"],
  cpseId: ["cpse", "organisation", "organization", "plant name", "psu", "company", "source cpse", "vendor org"],
  quantity: ["qty", "quantity", "stock qty", "order qty"],
  unitPrice: ["unit price", "rate", "unit rate", "price"],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function nameScore(header: string, role: Role): number {
  const n = normalize(header);
  if (!n) return 0;
  return NAME_ALIASES[role].some((a) => n === a || n.includes(a)) ? 1 : 0;
}
function sample(vals: string[], n = 25): string[] {
  return vals.filter((v) => v.trim() !== "").slice(0, n);
}
/**
 * Parses real-world numeric cells: thousands separators in both Western
 * ("1,234.50") and Indian ("1,25,000") grouping, and currency markers
 * (₹, Rs., INR, $). parseFloat("1,234.50") returns 1 — silently wrong by
 * three orders of magnitude, which the economics roll-up would have
 * faithfully summed. Returns NaN for anything not cleanly numeric.
 */
export function parseNumber(raw: unknown): number {
  if (typeof raw === "number") return raw;
  let s = String(raw ?? "").trim();
  if (!s) return NaN;
  const negative = /^\(.*\)$/.test(s); // accounting style (1,200)
  s = s.replace(/^\(|\)$/g, "").replace(/^(?:₹|RS\.?|INR|\$)\s*/i, "").replace(/\s*(?:₹|RS\.?|INR)$/i, "");
  if (!/^-?\d{1,3}(,\d{2,3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s.replace(/,/g, ""));
  return negative ? -n : n;
}

function isNumericColumn(vals: string[]): boolean {
  const s = sample(vals);
  if (s.length === 0) return false;
  return s.filter((v) => Number.isFinite(parseNumber(v))).length / s.length > 0.7;
}

function contentScore(vals: string[], role: Role): number {
  const s = sample(vals);
  if (s.length === 0) return 0;

  if (role === "uom") return s.filter((v) => COMMON_UOMS.includes(v.trim().toUpperCase())).length / s.length;

  if (role === "cpseId") {
    const hits = s.filter((v) => CPSE_LIST.includes(v.trim().toUpperCase())).length;
    if (hits / s.length > 0.5) return 1;
    const unique = new Set(s.map((v) => v.trim().toUpperCase()));
    const categorical = unique.size <= Math.max(2, Math.min(10, Math.ceil(s.length / 3)));
    const shortVals = s.every((v) => v.trim().length <= 12);
    return categorical && shortVals ? 0.3 : 0;
  }

  if (role === "quantity" || role === "unitPrice") return isNumericColumn(s) ? 0.6 : 0;

  if (role === "description") {
    const avgWords = s.reduce((sum, v) => sum + v.trim().split(/\s+/).length, 0) / s.length;
    const avgLen = s.reduce((sum, v) => sum + v.length, 0) / s.length;
    return Math.min(1, avgWords / 4) * 0.6 + Math.min(1, avgLen / 25) * 0.4;
  }

  if (role === "ownCode") {
    const codeLike = s.filter((v) => /^[A-Za-z0-9][A-Za-z0-9\-/_.]{2,20}$/.test(v.trim()) && /\d/.test(v)).length;
    const uniqueness = new Set(s.map((v) => v.trim())).size / s.length;
    return (codeLike / s.length) * 0.6 + uniqueness * 0.4;
  }
  return 0;
}

interface ColumnAssignment {
  ownCode: number | null;
  description: number | null;
  uom: number | null;
  cpseId: number | null;
  quantity: number | null;
  unitPrice: number | null;
}

function resolveColumns(headers: string[], dataRows: string[][], hasRealHeader: boolean): ColumnAssignment {
  const colCount = headers.length;
  const roles: Role[] = ["ownCode", "description", "uom", "cpseId", "quantity", "unitPrice"];
  const scores: { role: Role; col: number; score: number }[] = [];

  for (let col = 0; col < colCount; col++) {
    const colValues = dataRows.map((r) => r[col] ?? "");
    const header = hasRealHeader ? headers[col] : "";
    for (const role of roles) {
      const nScore = hasRealHeader ? nameScore(header, role) : 0;
      const cScore = contentScore(colValues, role);
      const blended = nScore > 0 ? 0.75 * nScore + 0.25 * cScore : cScore;
      scores.push({ role, col, score: blended });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  const assignment: ColumnAssignment = { ownCode: null, description: null, uom: null, cpseId: null, quantity: null, unitPrice: null };
  const used = new Set<number>();
  const MIN: Record<Role, number> = { ownCode: 0.3, description: 0.25, uom: 0.4, cpseId: 0.3, quantity: 0.55, unitPrice: 0.55 };

  for (const s of scores) {
    if (assignment[s.role] !== null || used.has(s.col) || s.score < MIN[s.role]) continue;
    assignment[s.role] = s.col;
    used.add(s.col);
  }

  if (assignment.description === null) {
    let best = -1, bestLen = -1;
    for (let col = 0; col < colCount; col++) {
      if (used.has(col)) continue;
      const avgLen = dataRows.reduce((sum, r) => sum + (r[col] ?? "").length, 0) / Math.max(1, dataRows.length);
      if (avgLen > bestLen) { bestLen = avgLen; best = col; }
    }
    if (best >= 0) assignment.description = best;
  }
  return assignment;
}

// ---------------------------------------------------------------------------
// Public entry point. `fallbackCpseId` applies unless the file itself has a
// detected CPSE/organization column (a mixed multi-CPSE file) — then each
// row uses its own value.
// ---------------------------------------------------------------------------

export async function parseCpseFile(file: File, fallbackCpseId: string): Promise<{ materials: ParsedMaterial[]; skippedEmptyRows: number }> {
  if (file.size > MAX_BYTES) throw new ParseError(`${file.name}: file is larger than 25 MB.`);
  if (!/\.(csv|tsv|txt|xlsx|xls)$/i.test(file.name)) throw new ParseError(`${file.name}: unsupported file type (use CSV, TSV, TXT, XLSX or XLS).`);
  let grid: string[][];
  try {
    grid = await readFileToGrid(file);
  } catch {
    throw new ParseError(`${file.name}: the file could not be read — it may be corrupt or password-protected.`);
  }
  if (grid.length === 0) return { materials: [], skippedEmptyRows: 0 };

  const hasRealHeader = looksLikeHeaderRow(grid[0], grid[1]);
  const headers = hasRealHeader ? grid[0] : grid[0].map((_, i) => `col_${i}`);
  const dataRows = hasRealHeader ? grid.slice(1) : grid;
  const cols = resolveColumns(headers, dataRows, hasRealHeader);
  if (cols.description === null) {
    throw new ParseError(`${file.name}: no material description column found. Add a column such as "Description" or "Material Name".`);
  }

  const materials: ParsedMaterial[] = [];
  let skipped = 0;

  dataRows.forEach((row, i) => {
    const description = cols.description !== null ? String(row[cols.description] ?? "").trim() : "";
    if (!description) { skipped++; return; }

    const ownCode = cols.ownCode !== null ? String(row[cols.ownCode] ?? "").trim() : `ROW-${i + 1}`;
    const uom = cols.uom !== null ? String(row[cols.uom] ?? "").trim() : "";
    const cpseId = (cols.cpseId !== null ? String(row[cols.cpseId] ?? "").trim().toUpperCase() : "") || fallbackCpseId;
    const qtyRaw = cols.quantity !== null ? parseNumber(row[cols.quantity]) : NaN;
    const priceRaw = cols.unitPrice !== null ? parseNumber(row[cols.unitPrice]) : NaN;

    const ex = extractAttributes(description);

    materials.push({
      id: `${cpseId}::${file.name}::${i + 1}`,
      cpseId,
      sourceFile: file.name,
      rowNumber: i + 1,
      rawDescription: description,
      ownCode,
      uom,
      quantity: Number.isFinite(qtyRaw) ? qtyRaw : null,
      unitPrice: Number.isFinite(priceRaw) ? priceRaw : null,
      category: ex.category,
      catCode: ex.catCode,
      subtype: ex.subtype,
      attrs: ex.attrs,
      corrosionClass: ex.corrosionClass,
      strengthRank: ex.strengthRank,
      classifiedBy: "rules",
    });
  });

  return { materials, skippedEmptyRows: skipped };
}
