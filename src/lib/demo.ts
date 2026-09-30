import type { CpseUpload } from "./pipeline";
import { CPSE_LIST } from "./constants";

// The synthetic 8-CPSE demo set lives in /public/sample-data and is served
// as static files. Tags are fixed here, so the demo never depends on the
// order files are picked in.
export const DEMO_BASE = "/sample-data/";
export const DEMO_FILES: { cpseId: string; file: string }[] = [
  { cpseId: "ONGC", file: "ONGC_material_master.csv" },
  { cpseId: "IOCL", file: "IOCL_material_master.csv" },
  { cpseId: "SAIL", file: "SAIL_material_master.csv" },
  { cpseId: "BHEL", file: "BHEL_material_master.xlsx" },
  { cpseId: "CPCL", file: "CPCL_material_master.csv" },
  { cpseId: "BPCL", file: "BPCL_material_master.csv" },
  { cpseId: "NTPC", file: "NTPC_material_master.csv" },
  { cpseId: "HPCL", file: "HPCL_material_master.csv" },
];

/** Downloads the demo files and returns them ready for the pipeline. */
export async function loadDemoUploads(fetchImpl: typeof fetch = fetch): Promise<CpseUpload[]> {
  const uploads: CpseUpload[] = [];
  for (const d of DEMO_FILES) {
    const res = await fetchImpl(DEMO_BASE + d.file);
    if (!res.ok) throw new Error(`Could not load demo file ${d.file} (HTTP ${res.status}).`);
    const blob = await res.blob();
    uploads.push({ cpseId: d.cpseId, file: new File([blob], d.file) });
  }
  return uploads;
}

/**
 * Guesses the CPSE from a file name such as "ONGC_material_master.csv" so the
 * tag is right without the user having to fix a dropdown. Returns null when no
 * known CPSE name appears as a whole word.
 */
export function detectCpseFromFilename(name: string): string | null {
  const up = name.toUpperCase();
  const byLength = [...CPSE_LIST].sort((a, b) => b.length - a.length);
  for (const c of byLength) {
    const pattern = c.replace(/ /g, "[ _-]?");
    if (new RegExp(`(^|[^A-Z])${pattern}([^A-Z]|$)`).test(up)) return c;
  }
  return null;
}
