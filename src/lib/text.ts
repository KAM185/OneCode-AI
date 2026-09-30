// Text utilities shared by the whole pipeline. Everything here is pure and
// deterministic — no ML, no I/O.

export const STOPWORDS = new Set([
  "OF", "THE", "AND", "FOR", "WITH", "TO", "IN", "A", "AN", "AS", "PER", "TYPE", "ITEM", "STD",
  "STANDARD", "MAKE", "NOS", "PCS", "EA", "EACH", "QTY", "SET", "SIZE", "MATERIAL", "MM", "OR",
]);

/** Uppercase, unify quote marks / multiplication signs, keep punctuation. */
export function preprocess(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[×]/g, "X")
    .replace(/(\d)\s*(?:"|”|″|'')/g, "$1 INCH ")
    .replace(/[“”″]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(raw: string): string[] {
  return preprocess(raw).replace(/[^A-Z0-9]+/g, " ").split(" ").filter(Boolean);
}

export function contentTokens(raw: string): string[] {
  return tokenize(raw).filter((t) => !STOPWORDS.has(t));
}

/** Order-insensitive canonical form of a description (used for hash codes). */
export function tokenKey(raw: string): string {
  return [...new Set(contentTokens(raw))].sort().join(" ");
}

export function padded(raw: string): string {
  return " " + tokenize(raw).join(" ") + " ";
}

export function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function trigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = `  ${s} `;
  for (let i = 0; i < t.length - 2; i++) {
    const g = t.slice(i, i + 3);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Character-trigram cosine similarity — robust to typos and word order. */
export function trigramCosine(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let dot = 0, na = 0, nb = 0;
  for (const [g, c] of ta) {
    na += c * c;
    const o = tb.get(g);
    if (o) dot += c * o;
  }
  for (const c of tb.values()) nb += c * c;
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

const hasDigit = (t: string) => /\d/.test(t);

/** True when both texts carry numbers (sizes, ratings) that mostly disagree. */
export function numericMismatch(ta: string[], tb: string[]): boolean {
  const na = ta.filter(hasDigit);
  const nb = tb.filter(hasDigit);
  if (na.length === 0 || nb.length === 0) return false;
  return jaccard(na, nb) < 0.5;
}

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function fnv(str: string, seed: number, prime: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, prime) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic 40-bit hash rendered as 8 base32 characters. */
export function shortHash(s: string, len = 8): string {
  const h1 = fnv(s, 2166136261, 16777619);
  const h2 = fnv(s, 0x9747b28c, 0x85ebca6b);
  let n = (BigInt(h1) << 32n) | BigInt(h2);
  n &= (1n << BigInt(len * 5)) - 1n;
  let out = "";
  for (let i = 0; i < len; i++) {
    out = B32[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

export function cosineVec(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are L2-normalised by the embedder
}
