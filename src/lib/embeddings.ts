// Local, in-browser semantic matching — replaces the old bag-of-words
// stand-in with a real sentence-embedding model (all-MiniLM-L6-v2, ~23MB
// quantized), run entirely client-side via WASM. No network call is made
// with material data; the ONLY network activity is a one-time, anonymous
// download of the public model weights from the model host (same origin
// class as loading a web font), which is cacheable and can be pre-bundled
// for a fully air-gapped deployment — see scripts/setup-offline.mjs.
//
// If the model can't load (offline environment, blocked host, slow link),
// every caller degrades to the trigram-cosine fallback in text.ts rather
// than failing — the app always produces a result, just with a less
// nuanced "unclear wording" signal, and this is reported honestly in
// RunStats.embedderStatus rather than silently swapped in.

import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { cosineVec } from "./text";

export type EmbedderStatus = "not-needed" | "loading" | "ready" | "unavailable";

let status: EmbedderStatus = "not-needed";
let extractor: FeatureExtractionPipeline | null = null;
let loadPromise: Promise<FeatureExtractionPipeline> | null = null;

export function getEmbedderStatus(): EmbedderStatus {
  return status;
}

async function loadExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;
  if (!loadPromise) {
    status = "loading";
    loadPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" })
      .then((p) => {
        extractor = p as FeatureExtractionPipeline;
        status = "ready";
        return extractor;
      })
      .catch((err) => {
        status = "unavailable";
        loadPromise = null;
        throw err;
      });
  }
  return loadPromise;
}

/** Best-effort warmup — call once when a run starts so the model is ready
 * before the first comparison needs it, without blocking file parsing. */
export function warmupEmbedder(): void {
  if (status === "not-needed") loadExtractor().catch(() => void 0);
}

// ---------------------------------------------------------------------------
// Vector cache. Every distinct description is embedded AT MOST ONCE per
// session; all later comparisons are plain dot products on cached vectors.
// Before this, comparing material A against B, C, D re-ran the model on A
// every time (and classifyBySimilarity re-embedded every subtype prototype
// for every unrecognised row) — the difference between seconds and minutes
// on a real material master.
//
// Keyed by a normalised form of the text (trim + collapse whitespace +
// lowercase — MiniLM is uncased, so this loses nothing). A Map keyed by the
// string is a hash lookup with no collision risk, unlike a truncated digest.
// ---------------------------------------------------------------------------

const MAX_CACHE_ENTRIES = 100_000; // ~150 MB worst case at 384 floats each
const BATCH_SIZE = 32;
const cache = new Map<string, Float32Array>();
let modelTextsEmbedded = 0; // texts actually sent to the model
let cacheHits = 0;

function cacheKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function remember(key: string, vec: Float32Array) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, vec);
}

export function getEmbeddingStats(): { modelTextsEmbedded: number; cacheHits: number; cacheSize: number } {
  return { modelTextsEmbedded, cacheHits, cacheSize: cache.size };
}

export function resetEmbeddingCache(): void {
  cache.clear();
  modelTextsEmbedded = 0;
  cacheHits = 0;
}

/** Test seam: replace the model with a fake extractor (or null to restore). */
export function __setExtractorForTests(fake: FeatureExtractionPipeline | null): void {
  extractor = fake;
  loadPromise = null;
  status = fake ? "ready" : "not-needed";
}

/** Raw model call — no caching. Returns null (never throws) on failure. */
async function embedRaw(texts: string[]): Promise<Float32Array[] | null> {
  if (texts.length === 0) return [];
  try {
    const model = await loadExtractor();
    const vectors: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const chunk = texts.slice(i, i + BATCH_SIZE);
      const output = await model(chunk, { pooling: "mean", normalize: true });
      const dims = (output as { dims: number[] }).dims;
      const data = (output as { data: Float32Array }).data;
      const width = dims[dims.length - 1];
      for (let j = 0; j < chunk.length; j++) vectors.push(data.slice(j * width, (j + 1) * width));
    }
    modelTextsEmbedded += texts.length;
    return vectors;
  } catch {
    return null;
  }
}

/**
 * Cached batch embedding: only texts not already in the cache reach the
 * model (deduplicated, in batches). Returns vectors aligned with `texts`,
 * or null if the model is unavailable (callers must have a fallback).
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[] | null> {
  if (texts.length === 0) return [];
  const keys = texts.map(cacheKey);
  const missingKeys: string[] = [];
  const missingTexts: string[] = [];
  const seen = new Set<string>();
  keys.forEach((k, i) => {
    if (cache.has(k)) cacheHits++;
    else if (!seen.has(k)) {
      seen.add(k);
      missingKeys.push(k);
      missingTexts.push(texts[i]);
    }
  });

  if (missingTexts.length > 0) {
    const fresh = await embedRaw(missingTexts);
    if (!fresh) return null;
    missingKeys.forEach((k, i) => remember(k, fresh[i]));
  }
  // Read after the write so eviction of a just-inserted key can't matter for
  // batches smaller than the cache cap.
  const out: Float32Array[] = [];
  for (const k of keys) {
    const v = cache.get(k);
    if (!v) return null;
    out.push(v);
  }
  return out;
}

/** Warm the cache for a known set of texts in as few model calls as
 * possible. Returns false if the model is unavailable. */
export async function prefetchEmbeddings(texts: string[]): Promise<boolean> {
  if (getEmbedderStatus() === "unavailable") return false;
  const unique = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  const r = await embedBatch(unique);
  return r !== null;
}

export async function embedSimilarity(a: string, b: string): Promise<number | null> {
  const v = await embedBatch([a, b]);
  if (!v) return null;
  return cosineVec(v[0], v[1]);
}

/** Zero-shot classification of an unrecognized description against the
 * dictionary's subtype prototypes — used ONLY when the rule-based parser
 * (dictionary.ts) found no match, so most rows never touch this at all.
 * Prototype vectors are cached, so per-row cost is one (cached) embedding. */
export async function classifyBySimilarity(
  text: string,
  prototypes: { code: string; text: string }[]
): Promise<{ code: string; score: number } | null> {
  const vectors = await embedBatch([text, ...prototypes.map((p) => p.text)]);
  if (!vectors) return null;
  const [qv, ...rest] = vectors;
  let best = { code: "", score: -1 };
  rest.forEach((v, i) => {
    const s = cosineVec(qv, v);
    if (s > best.score) best = { code: prototypes[i].code, score: s };
  });
  return best.score > 0.45 ? best : null; // below this, "unrecognized" is more honest than a forced guess
}
