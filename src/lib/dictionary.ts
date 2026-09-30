import type { Rank } from "./types";
import { padded, preprocess, tokenize } from "./text";

// ===========================================================================
// The shared canonical dictionary.
//
// Every CPSE resolves raw text through this SAME table, which is what lets
// independent pipelines converge on the identical NMC code without talking
// to each other. It is data, not logic: extending coverage means adding rows.
// ===========================================================================

interface Entry {
  canonical: string;
  synonyms: string[];
}
interface Compiled {
  canonical: string;
  syns: string[]; // padded token strings
}

function compile(entries: Entry[]): Compiled[] {
  return entries.map((e) => ({ canonical: e.canonical, syns: e.synonyms.map(padded) }));
}

/** Longest matching synonym wins (so SS316L beats SS316 beats SS). */
function findLongest(dict: Compiled[], text: string): string | null {
  let best: string | null = null;
  let bestLen = 0;
  for (const e of dict) {
    for (const s of e.syns) {
      if (s.length > bestLen && text.includes(s)) {
        best = e.canonical;
        bestLen = s.length;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Material grades (base material) and their corrosion behaviour
// ---------------------------------------------------------------------------

function stainless(n: string): Entry {
  return {
    canonical: `SS${n}`,
    synonyms: [
      `ss${n}`, `ss ${n}`, `stainless steel ${n}`, `stainless steel gr ${n}`, `stainless steel grade ${n}`,
      `stainless ${n}`, `${n} ss`, `${n} stainless`, `aisi ${n}`, `f${n}`, `tp${n}`, `a2 ${n}`,
    ],
  };
}

const GRADE_ENTRIES: Entry[] = [
  stainless("316L"), stainless("316"), stainless("304L"), stainless("304"), stainless("410"),
  { canonical: "SS", synonyms: ["stainless steel", "stainless", "ss"] },
  { canonical: "MS", synonyms: ["mild steel", "ms"] },
  { canonical: "CS", synonyms: ["carbon steel", "cs"] },
  { canonical: "A105", synonyms: ["astm a105", "a105", "a 105"] },
  { canonical: "A106B", synonyms: ["a106 gr b", "a106 grade b", "a106 b", "astm a106 b", "a106b", "a106"] },
  { canonical: "A234WPB", synonyms: ["a234 wpb", "a234wpb", "wpb"] },
  { canonical: "WCB", synonyms: ["a216 wcb", "wcb"] },
  { canonical: "LF2", synonyms: ["a350 lf2", "lf2"] },
  { canonical: "B7", synonyms: ["a193 b7", "a193 gr b7", "b7"] },
  { canonical: "2H", synonyms: ["a194 2h", "a194 gr 2h", "2h"] },
  { canonical: "A333-6", synonyms: ["a333 gr 6", "a333 gr6", "a333 6"] },
  { canonical: "CI", synonyms: ["cast iron", "ci"] },
  { canonical: "DI", synonyms: ["ductile iron", "sg iron", "di"] },
  { canonical: "BRASS", synonyms: ["brass"] },
  { canonical: "BRONZE", synonyms: ["bronze", "gunmetal"] },
  { canonical: "CU", synonyms: ["copper"] },
  { canonical: "AL", synonyms: ["aluminium", "aluminum"] },
  { canonical: "PVC", synonyms: ["pvc", "upvc", "cpvc"] },
  { canonical: "HDPE", synonyms: ["hdpe"] },
  { canonical: "PTFE", synonyms: ["ptfe", "teflon"] },
  { canonical: "GRAPHITE", synonyms: ["graphite"] },
];

const GRADE_CORROSION: Record<string, Rank> = {
  SS: "HIGH", SS304: "HIGH", SS304L: "HIGH", SS316: "HIGH", SS316L: "HIGH", SS410: "MEDIUM",
  MS: "LOW", CS: "LOW", A105: "LOW", A106B: "LOW", A234WPB: "LOW", WCB: "LOW", LF2: "LOW", B7: "LOW",
  "2H": "LOW", "A333-6": "LOW", CI: "LOW", DI: "LOW", BRASS: "MEDIUM", BRONZE: "MEDIUM", CU: "MEDIUM",
  AL: "MEDIUM", PVC: "HIGH", HDPE: "HIGH", PTFE: "HIGH", GRAPHITE: "HIGH",
};

const FINISH_ENTRIES: Entry[] = [
  { canonical: "ZN", synonyms: ["zinc plated", "zinc plating", "zinc coated", "electro galvanised", "electro galvanized", "electrogalvanised", "zn plated", "zp", "zinc", "zn"] },
  { canonical: "HDG", synonyms: ["hot dip galvanised", "hot dip galvanized", "hdg", "galvanised", "galvanized", "gi"] },
  { canonical: "BLK", synonyms: ["black oxide", "blackened", "black"] },
];

// ---------------------------------------------------------------------------
// Standards (with dimensional-equivalence groups)
// ---------------------------------------------------------------------------

function std(prefix: string, num: string, extra: string[] = []): Entry {
  const n2 = num.replace(/\./g, "");
  return {
    canonical: `${prefix}${num}`,
    synonyms: [`${prefix} ${num}`, `${prefix}${num}`, `${prefix} ${n2}`, `${prefix}${n2}`, ...extra],
  };
}
function asme(n: string, extra: string[] = []): Entry {
  const n2 = n.replace(/\./g, "");
  return {
    canonical: `B${n}`,
    synonyms: [`asme b${n}`, `ansi b${n}`, `b${n}`, `asme/ansi b${n}`, `ansi/asme b${n}`, `asme b${n2}`, `ansi b${n2}`, `b${n2}`, ...extra],
  };
}

const STANDARD_ENTRIES: Entry[] = [
  ...["934", "933", "931", "912", "125", "127", "985", "439", "6921"].map((n) => std("DIN", n)),
  ...["4032", "4033", "4014", "4017", "4762", "7089", "7090"].map((n) => std("ISO", n)),
  ...["1363", "1364", "1367", "2062", "1239", "3589", "1161", "1554", "7098", "325"].map((n) => std("IS", n)),
  ...["16.5", "16.9", "16.11", "16.20", "16.21", "16.34", "16.47", "36.10", "36.19"].map((n) => asme(n)),
  ...["6D", "600", "602", "594", "608", "598"].map((n) => std("API", n)),
  ...["1873", "5352", "1414", "5351"].map((n) => std("BS", n)),
  std("EN", "10025"),
  std("EN", "1092-1", ["en 1092"]),
];

/** Standards that are dimensionally interchangeable (reviewed, never auto-merged). */
export const STANDARD_EQUIV: string[][] = [
  ["DIN934", "ISO4032"],
  ["DIN933", "ISO4017"],
  ["DIN931", "ISO4014"],
  ["DIN125", "ISO7089"],
  ["DIN912", "ISO4762"],
];

export function standardsEquivalent(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return STANDARD_EQUIV.some((g) => g.includes(a) && g.includes(b));
}

// ---------------------------------------------------------------------------
// Subtypes (material categories)
// ---------------------------------------------------------------------------

export interface SubtypeDef {
  code: string;
  category: string;
  catCode: string;
  label: string;
  synonyms: string[];
  exclude: string[]; // tokens that veto this subtype
  dimAttrs: string[]; // REQUIRED for a complete identity; mismatch => different material
  matAttrs: string[]; // optional; mismatch => "similar / functionally equivalent" review
  pressureBearing: boolean;
}

export const SUBTYPES: SubtypeDef[] = [
  {
    code: "HNT", category: "Fastener", catCode: "FAS", label: "HEX NUT", pressureBearing: true,
    synonyms: ["hex nut", "hexagon nut", "hexagonal nut", "nut hexagon", "nut hex", "nut hexagonal", "nut"],
    exclude: ["lock", "wing", "castle", "nylock", "cap", "dome", "square", "coupling", "flange", "weld", "slotted", "insert"],
    dimAttrs: ["thread"], matAttrs: ["grade", "finish", "propClass", "standard"],
  },
  {
    code: "BLT", category: "Fastener", catCode: "FAS", label: "BOLT", pressureBearing: true,
    synonyms: ["hex bolt", "hexagon bolt", "hex head bolt", "hexagonal head bolt", "bolt hex", "bolt hexagon", "bolt", "hex screw", "screw hex", "cap screw", "machine screw", "screw"],
    exclude: ["stud", "anchor", "eye", "u", "foundation", "rag", "j", "carriage", "tapping", "grub", "wood"],
    dimAttrs: ["thread", "length"], matAttrs: ["grade", "finish", "propClass", "standard"],
  },
  {
    code: "STD", category: "Fastener", catCode: "FAS", label: "STUD", pressureBearing: true,
    synonyms: ["stud bolt", "studbolt", "stud", "threaded rod", "all thread"],
    exclude: [],
    dimAttrs: ["thread", "length"], matAttrs: ["grade", "finish", "standard"],
  },
  {
    code: "WSH", category: "Fastener", catCode: "FAS", label: "WASHER", pressureBearing: false,
    synonyms: ["flat washer", "plain washer", "spring washer", "lock washer", "washer"],
    exclude: [],
    dimAttrs: ["thread"], matAttrs: ["washerKind", "grade", "finish", "standard"],
  },
  {
    code: "FLG", category: "Piping", catCode: "PIP", label: "FLANGE", pressureBearing: true,
    synonyms: ["flange", "flg"],
    exclude: ["bolt", "gasket", "nut", "stud"],
    dimAttrs: ["size", "pressure"], matAttrs: ["flgType", "face", "grade", "standard"],
  },
  {
    code: "VLV", category: "Piping", catCode: "PIP", label: "VALVE", pressureBearing: true,
    synonyms: ["gate valve", "globe valve", "ball valve", "check valve", "butterfly valve", "needle valve", "plug valve", "non return valve", "nrv", "valve"],
    exclude: ["actuator", "spindle", "seat", "kit", "wheel"],
    dimAttrs: ["valveType", "size", "pressure"], matAttrs: ["endConn", "grade", "standard"],
  },
  {
    code: "PPE", category: "Piping", catCode: "PIP", label: "PIPE", pressureBearing: true,
    synonyms: ["pipe", "tube", "tubing"],
    exclude: ["fitting", "flange", "clamp", "support", "hanger", "wrench", "cutter", "bracket", "threader", "cap", "elbow", "tee"],
    dimAttrs: ["size", "schedule"], matAttrs: ["pipeType", "grade", "standard"],
  },
  {
    code: "FIT", category: "Piping", catCode: "PIP", label: "FITTING", pressureBearing: true,
    synonyms: ["elbow", "tee", "reducer", "coupling", "union", "bend", "cap", "nipple"],
    exclude: ["screw", "bolt", "nut"],
    dimAttrs: ["fitType", "size"], matAttrs: ["schedule", "endConn", "grade", "standard"],
  },
  {
    code: "GSK", category: "Piping", catCode: "PIP", label: "GASKET", pressureBearing: true,
    synonyms: ["spiral wound gasket", "ring joint gasket", "rtj gasket", "gasket"],
    exclude: [],
    dimAttrs: ["gasketType", "size", "pressure"], matAttrs: ["grade", "standard"],
  },
  {
    code: "MTR", category: "Electrical", catCode: "ELE", label: "MOTOR", pressureBearing: false,
    synonyms: ["electric motor", "induction motor", "motor"],
    exclude: ["valve", "operated", "starter", "protection", "pump", "mounting", "control"],
    dimAttrs: ["power", "poles"], matAttrs: ["voltage", "phase", "standard"],
  },
  {
    code: "CBL", category: "Electrical", catCode: "ELE", label: "CABLE", pressureBearing: false,
    synonyms: ["power cable", "control cable", "instrumentation cable", "cable"],
    exclude: ["tray", "gland", "lug", "tie", "joint", "termination", "trunking", "duct", "clamp", "ladder", "drum"],
    dimAttrs: ["cores", "csa"], matAttrs: ["conductor", "insulation", "voltage", "standard"],
  },
  {
    code: "BRG", category: "Mechanical", catCode: "MEC", label: "BEARING", pressureBearing: false,
    synonyms: ["ball bearing", "roller bearing", "bearing"],
    exclude: ["housing", "puller", "grease", "sleeve", "plummer"],
    dimAttrs: ["bearingNo"], matAttrs: ["seal"],
  },
  {
    code: "PLT", category: "Structural", catCode: "STL", label: "PLATE", pressureBearing: false,
    synonyms: ["chequered plate", "checkered plate", "plate", "sheet"],
    exclude: ["base", "name", "tube", "heat", "gasket", "flange", "number"],
    dimAttrs: ["thickness"], matAttrs: ["grade", "standard"],
  },
  {
    code: "STR", category: "Structural", catCode: "STL", label: "SECTION", pressureBearing: false,
    synonyms: ["ismb", "ismc", "islb", "isjb", "iswb", "ishb", "angle", "channel", "beam", "joist"],
    exclude: ["valve", "gauge", "bracket", "joint"],
    dimAttrs: ["section"], matAttrs: ["grade", "standard"],
  },
  {
    code: "GAG", category: "Instrumentation", catCode: "INS", label: "PRESSURE GAUGE", pressureBearing: false,
    synonyms: ["pressure gauge", "manometer", "gauge"],
    exclude: ["level", "temperature", "thermometer", "glass", "valve", "isolation"],
    dimAttrs: ["range", "dial"], matAttrs: ["endConn", "grade"],
  },
  {
    code: "LUB", category: "Consumable", catCode: "CON", label: "LUBRICANT", pressureBearing: false,
    synonyms: ["lubricating oil", "lube oil", "engine oil", "gear oil", "hydraulic oil", "turbine oil", "compressor oil", "transformer oil", "grease"],
    exclude: ["seal", "filter", "pump", "cooler", "gauge", "level", "separator", "ring", "cap", "tank", "bath", "sight"],
    dimAttrs: ["lubType", "viscosity"], matAttrs: [],
  },
];

const SUBTYPE_BY_CODE = new Map(SUBTYPES.map((s) => [s.code, s]));
export function getSubtype(code: string): SubtypeDef | undefined {
  return SUBTYPE_BY_CODE.get(code);
}

interface CompiledSubtype {
  def: SubtypeDef;
  syns: string[];
  exclude: string[];
}
const COMPILED_SUBTYPES: CompiledSubtype[] = SUBTYPES.map((def) => ({
  def,
  syns: def.synonyms.map(padded),
  exclude: def.exclude.map((e) => " " + e.toUpperCase() + " "),
}));

const GRADES = compile(GRADE_ENTRIES);
const FINISHES = compile(FINISH_ENTRIES);
const STANDARDS = compile(STANDARD_ENTRIES);

/** Earliest matching head-noun wins (descriptions lead with the item); ties -> longest. */
function detectSubtype(pad: string): SubtypeDef | null {
  let best: SubtypeDef | null = null;
  let bestIdx = Infinity;
  let bestLen = 0;
  for (const c of COMPILED_SUBTYPES) {
    if (c.exclude.some((x) => pad.includes(x))) continue;
    for (const s of c.syns) {
      const idx = pad.indexOf(s);
      if (idx < 0) continue;
      if (idx < bestIdx || (idx === bestIdx && s.length > bestLen)) {
        best = c.def;
        bestIdx = idx;
        bestLen = s.length;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Attribute extractors (regex, deterministic, millisecond-fast)
// ---------------------------------------------------------------------------

const INCH_TO_DN: Record<string, number> = {
  "0.5": 15, "1/2": 15, "0.75": 20, "3/4": 20, "1": 25, "1.25": 32, "1-1/4": 32, "1 1/4": 32,
  "1.5": 40, "1-1/2": 40, "1 1/2": 40, "2": 50, "2.5": 65, "2-1/2": 65, "2 1/2": 65, "3": 80, "4": 100,
  "5": 125, "6": 150, "8": 200, "10": 250, "12": 300, "14": 350, "16": 400, "18": 450, "20": 500, "24": 600,
};
const DN_VALUES = new Set(Object.values(INCH_TO_DN));
const PRESSURE_CLASSES = new Set([125, 150, 300, 400, 600, 800, 900, 1500, 2500, 3000, 6000, 9000]);
const HP_TO_KW: Record<string, string> = {
  "0.5": "0.37", "1": "0.75", "1.5": "1.1", "2": "1.5", "3": "2.2", "5": "3.7", "7.5": "5.5", "10": "7.5",
  "15": "11", "20": "15", "25": "18.5", "30": "22", "40": "30", "50": "37", "60": "45", "75": "55", "100": "75",
  "125": "90", "150": "110", "200": "150",
};

const num = (s: string) => String(parseFloat(s));

function extractThreadLength(u: string): { thread?: string; length?: string } {
  const out: { thread?: string; length?: string } = {};
  // Up to 3 digits (M100, M120…) and never a silent truncation: without the
  // lookahead, "M100" matched as "M10" and "M150" as "M15", so different
  // sizes collapsed onto the same national code.
  const m = u.match(/\bM\s?(\d{1,3}(?:\.\d)?)(?!\d)\s?((?:[X*]\s?\d+(?:\.\d+)?\s?){0,2})/);
  if (m) {
    out.thread = `M${num(m[1])}`;
    const nums = (m[2] || "").split(/[X*]/).map((x) => x.trim()).filter(Boolean);
    const last = nums[nums.length - 1];
    if (last) {
      const v = parseFloat(last);
      if (nums.length === 2 || (Number.isInteger(v) && v >= 6)) out.length = `${num(last)}MM`;
    }
  }
  if (!out.length) {
    const l = u.match(/\b(\d{2,3})\s?MM\s?(?:LG|LONG|LENGTH)\b|\bLENGTH\s?[:=]?\s?(\d{2,3})\b|\bL\s?=\s?(\d{2,3})\b/);
    if (l) out.length = `${l[1] ?? l[2] ?? l[3]}MM`;
  }
  return out;
}

function extractSize(u: string, subtype: string): string | undefined {
  const dn = (inch: string) => {
    const key = inch.replace(/\s+/g, " ").trim();
    const v = INCH_TO_DN[key] ?? INCH_TO_DN[num(key)] ?? INCH_TO_DN[key.replace(" ", "-")];
    return v ? `DN${v}` : undefined;
  };
  const pair = u.match(/\b(\d{1,2}(?:\.\d+)?)\s?(?:INCH|IN)?\s?[X*]\s?(\d{1,2}(?:\.\d+)?)\s?(?:INCH|IN)\b/);
  if (pair) {
    const a = dn(pair[1]);
    const b = dn(pair[2]);
    if (a && b) return `${a}X${b}`;
  }
  const d = u.match(/\b(?:DN|NB)\s?(\d{2,4})\b/);
  if (d) return `DN${d[1]}`;
  const inch = u.match(/\b(\d{1,2}(?:[-\s]\d\/\d|\.\d+|\/\d)?)\s?(?:INCH|INCHES|IN)\b/);
  if (inch) {
    const r = dn(inch[1]);
    if (r) return r;
  }
  if (["PPE", "FLG", "VLV", "FIT", "GSK"].includes(subtype)) {
    const mm = u.match(/\b(\d{2,3})\s?MM\b/);
    if (mm && DN_VALUES.has(parseInt(mm[1], 10))) return `DN${mm[1]}`;
  }
  return undefined;
}

function extractPressure(u: string): string | undefined {
  const pn = u.match(/\bPN\s?-?(\d{1,3})\b/);
  if (pn) return `PN${pn[1]}`;
  const c = u.match(/\b(?:CLASS|CL|CLS|RATING)\.?\s?(\d{3,4})\b|\b(\d{3,4})\s?(?:#|LBS?)(?=\s|$)|\bANSI\s?(\d{3,4})\b/);
  if (c) {
    const v = parseInt(c[1] ?? c[2] ?? c[3], 10);
    if (PRESSURE_CLASSES.has(v)) return `CL${v}`;
  }
  return undefined;
}

function extractSchedule(u: string): string | undefined {
  const m = u.match(/\bSCH(?:EDULE)?\.?\s?(\d{1,3}S?|STD|XS|XXS)\b/);
  return m ? `SCH${m[1]}` : undefined;
}

function extractPower(u: string): string | undefined {
  const kw = u.match(/(\d+(?:\.\d+)?)\s?KW\b/);
  if (kw) return `${num(kw[1])}KW`;
  const hp = u.match(/(\d+(?:\.\d+)?)\s?HP\b/);
  if (hp) return `${HP_TO_KW[num(hp[1])] ?? (parseFloat(hp[1]) * 0.7457).toFixed(1)}KW`;
  return undefined;
}

function extractVoltage(u: string): string | undefined {
  const kv = u.match(/(\d+(?:\.\d+)?)\s?KV\b/);
  if (kv) return `${num(kv[1])}KV`;
  const v = u.match(/\b(\d{2,4})\s?V(?:OLTS?|AC)?\b/);
  return v ? `${v[1]}V` : undefined;
}

function extractPoles(u: string): string | undefined {
  const p = u.match(/\b([2468])\s?(?:P|POLE|POLES)\b/);
  if (p) return `${p[1]}P`;
  const r = u.match(/(\d{3,4})\s?RPM/);
  if (r) {
    const v = parseInt(r[1], 10);
    if (v >= 2500) return "2P";
    if (v >= 1300) return "4P";
    if (v >= 850) return "6P";
    if (v >= 650) return "8P";
  }
  return undefined;
}

function extractPhase(u: string): string | undefined {
  const m = u.match(/\b([13])\s?-?\s?(?:PH|PHASE)\b|\b(SINGLE|THREE)\s?-?\s?PHASE\b/);
  if (!m) return undefined;
  if (m[1]) return `${m[1]}PH`;
  return m[2] === "SINGLE" ? "1PH" : "3PH";
}

function extractCable(u: string): { cores?: string; csa?: string } {
  const m = u.match(/\b(\d+(?:\.\d+)?)\s?C(?:ORE|ORES)?\s?[X*]\s?(\d+(?:\.\d+)?)|\b(\d+)\s?[X*]\s?(\d+(?:\.\d+)?)\s?(?:SQ\.?\s?MM|SQMM|MM2)/);
  if (m) {
    const cores = m[1] ?? m[3];
    const csa = m[2] ?? m[4];
    return { cores: `${num(cores)}C`, csa: `${num(csa)}SQMM` };
  }
  const csa = u.match(/(\d+(?:\.\d+)?)\s?(?:SQ\.?\s?MM|SQMM|MM2)/);
  const cores = u.match(/\b(\d+)\s?(?:CORE|CORES)\b/);
  return { cores: cores ? `${cores[1]}C` : undefined, csa: csa ? `${num(csa[1])}SQMM` : undefined };
}

function extractBearing(u: string): { bearingNo?: string; seal?: string } {
  const m = u.match(/\b(NU|NJ|NUP|QJ)?\s?(6[0-4]\d{2}|[23]\d{4}|7[0-3]\d{2}|[12][0-3]\d{2})\b/);
  const s = u.match(/\b(2RS1?|2RSH|ZZ|2Z|RS|Z)\b/);
  const seal = s ? (s[1].startsWith("2RS") || s[1] === "RS" ? "2RS" : "ZZ") : undefined;
  return { bearingNo: m ? `${m[1] ?? ""}${m[2]}` : undefined, seal };
}

function extractThickness(u: string): string | undefined {
  const m =
    u.match(/(\d+(?:\.\d+)?)\s?MM\s?(?:THK\.?|THICK(?:NESS)?)\b/) ||
    u.match(/\bTHK\.?\s?(\d+(?:\.\d+)?)/) ||
    u.match(/\b(?:PLATE|SHEET)\b.*?(\d+(?:\.\d+)?)\s?MM\b/) ||
    u.match(/(\d+(?:\.\d+)?)\s?MM\b/);
  return m ? `${num(m[1])}MM` : undefined;
}

function extractSection(u: string): string | undefined {
  const m = u.match(/\b(ISMB|ISMC|ISLB|ISJB|ISWB|ISHB|ISA)\s?(\d+(?:\s?X\s?\d+){0,2})\b/);
  if (m) return `${m[1]}${m[2].replace(/\s+/g, "")}`;
  const a = u.match(/\bANGLE\s?(\d+\s?X\s?\d+\s?X\s?\d+)\b/);
  return a ? `ISA${a[1].replace(/\s+/g, "")}` : undefined;
}

function extractRange(u: string): { range?: string; dial?: string } {
  const r = u.match(/\b0\s?(?:-|TO)\s?(\d+(?:\.\d+)?)\s?(BAR|KG\/CM2|KG\/CM²|KG\/CM|PSI|MPA|KPA)\b/);
  const d = u.match(/\b(\d{2,3})\s?MM\s?(?:DIAL|DIA)\b|\bDIAL\s?(?:SIZE)?\s?(\d{2,3})\b/);
  return {
    range: r ? `0-${num(r[1])}${r[2].replace(/[^A-Z0-9]/g, "")}` : undefined,
    dial: d ? `DIAL${d[1] ?? d[2]}` : undefined,
  };
}

function extractViscosity(u: string): string | undefined {
  const vg = u.match(/\bISO\s?VG\s?(\d{2,4})\b|\bVG\s?(\d{2,4})\b/);
  if (vg) return `VG${vg[1] ?? vg[2]}`;
  const sae = u.match(/\bSAE\s?(\d{1,3}W?(?:\s?-\s?\d{1,3}W?)?)\b/);
  if (sae) return `SAE${sae[1].replace(/[\s-]/g, "")}`;
  const nlgi = u.match(/\bNLGI\s?(\d)\b/);
  return nlgi ? `NLGI${nlgi[1]}` : undefined;
}

function extractKeywords(pad: string): Record<string, string> {
  const out: Record<string, string> = {};
  const has = (w: string) => pad.includes(` ${w} `);
  const first = (pairs: [string, string][]) => pairs.find(([w]) => has(w))?.[1];

  const angle = /\b(45|90|180)\b/.exec(pad)?.[1];
  const fit = first([
    ["REDUCING TEE", "RTEE"], ["UNEQUAL TEE", "RTEE"], ["ECCENTRIC REDUCER", "ERED"], ["CONCENTRIC REDUCER", "CRED"],
    ["REDUCER", "RED"], ["TEE", "TEE"], ["COUPLING", "CPLG"], ["UNION", "UNION"], ["CAP", "CAP"], ["NIPPLE", "NIPPLE"],
    ["ELBOW", "ELBOW"], ["BEND", "BEND"],
  ]);
  if (fit) out.fitType = (fit === "ELBOW" || fit === "BEND") && angle ? `${fit}${angle}` : fit;

  const vt = first([
    ["GATE", "GATE"], ["GLOBE", "GLOBE"], ["BALL", "BALL"], ["CHECK", "CHECK"], ["NRV", "CHECK"], ["NON RETURN", "CHECK"],
    ["BUTTERFLY", "BFLY"], ["NEEDLE", "NEEDLE"], ["PLUG", "PLUG"], ["DIAPHRAGM", "DIAPH"],
  ]);
  if (vt) out.valveType = vt;

  const gt = first([
    ["SPIRAL WOUND", "SPW"], ["SPW", "SPW"], ["RING JOINT", "RTJ"], ["RTJ", "RTJ"], ["CAF", "CAF"],
    ["COMPRESSED ASBESTOS", "CAF"], ["NON ASBESTOS", "NAF"], ["PTFE", "PTFE"], ["GRAPHITE", "GRAPH"], ["RUBBER", "RUBBER"],
  ]);
  if (gt) out.gasketType = gt;

  const ft = first([["WELD NECK", "WN"], ["WN", "WN"], ["SLIP ON", "SO"], ["SO", "SO"], ["BLIND", "BL"], ["BL", "BL"], ["SOCKET WELD", "SW"], ["THREADED", "THD"], ["LAP JOINT", "LJ"]]);
  if (ft) out.flgType = ft;
  const face = first([["RAISED FACE", "RF"], ["RF", "RF"], ["FLAT FACE", "FF"], ["FF", "FF"], ["RTJ", "RTJ"]]);
  if (face) out.face = face;

  const ec = first([["FLANGED", "FLANGED"], ["SCREWED", "SCREWED"], ["THREADED", "SCREWED"], ["NPT", "SCREWED"], ["BSP", "SCREWED"], ["BUTT WELD", "BW"], ["BW", "BW"], ["SOCKET WELD", "SW"], ["SW", "SW"]]);
  if (ec) out.endConn = ec;

  const pt = first([["SEAMLESS", "SMLS"], ["SMLS", "SMLS"], ["ERW", "ERW"], ["WELDED", "WLD"]]);
  if (pt) out.pipeType = pt;

  const wk = first([["SPRING", "SPRING"], ["PLAIN", "PLAIN"], ["FLAT", "PLAIN"], ["LOCK", "LOCK"]]);
  if (wk) out.washerKind = wk;

  const lt = first([
    ["ENGINE OIL", "ENG"], ["GEAR OIL", "GEAR"], ["HYDRAULIC OIL", "HYD"], ["TURBINE OIL", "TUR"], ["COMPRESSOR OIL", "CMP"],
    ["TRANSFORMER OIL", "TRF"], ["GREASE", "GRS"],
  ]);
  if (lt) out.lubType = lt;

  const cond = first([["COPPER", "CU"], ["CU", "CU"], ["ALUMINIUM", "AL"], ["ALUMINUM", "AL"], ["AL", "AL"]]);
  if (cond) out.conductor = cond;
  const ins = first([["XLPE", "XLPE"], ["PVC", "PVC"], ["EPR", "EPR"]]);
  if (ins) out.insulation = ins;
  return out;
}

// ---------------------------------------------------------------------------
// Public: full extraction
// ---------------------------------------------------------------------------

export interface Extracted {
  subtype: string;
  category: string;
  catCode: string;
  attrs: Record<string, string>;
  corrosionClass: Rank | null;
  strengthRank: number | null;
}

const PROP_CLASSES = ["4.6", "4.8", "5.6", "5.8", "6.8", "8.8", "9.8", "10.9", "12.9"];

export function extractAttributes(description: string, forceSubtype?: string): Extracted {
  const u = preprocess(description);
  const pad = padded(description);
  const def = forceSubtype ? getSubtype(forceSubtype) ?? null : detectSubtype(pad);

  const raw: Record<string, string> = {};
  const set = (k: string, v?: string) => { if (v) raw[k] = v; };

  const tl = extractThreadLength(u);
  set("thread", tl.thread);
  set("length", tl.length);
  if (!raw.thread && def && ["HNT", "WSH", "BLT", "STD"].includes(def.code)) {
    const mm = u.match(/\b(\d{1,2})\s?MM\b/);
    if (mm && parseInt(mm[1], 10) >= 3 && parseInt(mm[1], 10) <= 64) raw.thread = `M${mm[1]}`;
  }
  set("size", extractSize(u, def?.code ?? ""));
  set("pressure", extractPressure(u));
  set("schedule", extractSchedule(u));
  set("power", extractPower(u));
  set("voltage", extractVoltage(u));
  set("poles", extractPoles(u));
  set("phase", extractPhase(u));
  const cab = extractCable(u);
  set("cores", cab.cores);
  set("csa", cab.csa);
  if (def?.code === "BRG") {
    const b = extractBearing(u);
    set("bearingNo", b.bearingNo);
    set("seal", b.seal);
  }
  if (def?.code === "PLT") set("thickness", extractThickness(u));
  set("section", extractSection(u));
  const g = extractRange(u);
  set("range", g.range);
  set("dial", g.dial);
  set("viscosity", extractViscosity(u));

  const pc = PROP_CLASSES.find((p) => new RegExp(`(^|[^0-9.])${p.replace(".", "\\.")}([^0-9.]|$)`).test(u));
  if (pc) raw.propClass = `PC${pc}`;
  else {
    const nutPc = u.match(/\b(?:GR(?:ADE)?|PC|PROPERTY CLASS)\.?\s?(4|5|6|8|10|12)\b/);
    if (nutPc) raw.propClass = `PC${nutPc[1]}`;
  }

  Object.assign(raw, extractKeywords(pad));

  const grade = findLongest(GRADES, pad);
  const finish = findLongest(FINISHES, pad);
  const standard = findLongest(STANDARDS, pad);
  set("grade", grade ?? undefined);
  set("finish", finish ?? undefined);
  set("standard", standard ?? undefined);

  // Corrosion class: base material rank, lifted one level by zinc/galvanised finish.
  let corrosion: Rank | null = grade ? GRADE_CORROSION[grade] ?? null : null;
  if (finish === "ZN" || finish === "HDG") {
    if (corrosion === "LOW") corrosion = "MEDIUM";
    else if (corrosion === null) corrosion = "MEDIUM";
  }
  const strengthRank = raw.propClass ? PROP_CLASSES.indexOf(raw.propClass.slice(2)) : null;

  if (!def) {
    return { subtype: "UNK", category: "Uncategorized", catCode: "UNC", attrs: raw, corrosionClass: corrosion, strengthRank };
  }
  const attrs: Record<string, string> = {};
  for (const k of [...def.dimAttrs, ...def.matAttrs]) if (raw[k]) attrs[k] = raw[k];
  return { subtype: def.code, category: def.category, catCode: def.catCode, attrs, corrosionClass: corrosion, strengthRank };
}

/** Prototype phrases for zero-shot AI classification of uncategorized items. */
export function subtypePrototypes(): { code: string; text: string }[] {
  return SUBTYPES.map((s) => ({ code: s.code, text: `${s.label.toLowerCase()} ${s.synonyms.slice(0, 3).join(" ")}` }));
}

export { tokenize };
