// Client for the one serverless function in this app: a shared index that
// stores only "NMC code -> which CPSEs use it", never material data. This is
// what makes cross-CPSE duplicate detection possible without any CPSE's
// actual data leaving its own browser session.

const ENDPOINT = "/.netlify/functions/fingerprint-index";
const CHUNK = 200; // server accepts up to 500; smaller chunks keep each request fast
const TIMEOUT_MS = 10_000;

export interface FingerprintBatchResult {
  /** false when the index couldn't be reached — distinct from "no matches". */
  reachable: boolean;
  /** nmcCode -> other CPSEs already using it */
  matches: Map<string, string[]>;
}

async function postJson(body: unknown, fetchImpl: typeof fetch): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Publishes a CPSE's codes and learns which other CPSEs already use them, in
 * a handful of batched requests (the previous client made one HTTP request
 * per unique code — thousands for a real material master). Never throws:
 * if the function isn't deployed / is offline, returns reachable=false so the
 * UI can say so instead of implying "no other CPSE uses these codes".
 */
export async function checkAndPublishFingerprints(
  nmcCodes: string[],
  cpseId: string,
  fetchImpl: typeof fetch = fetch
): Promise<FingerprintBatchResult> {
  const unique = [...new Set(nmcCodes)];
  const matches = new Map<string, string[]>();
  try {
    for (let i = 0; i < unique.length; i += CHUNK) {
      const res = await postJson({ nmcCodes: unique.slice(i, i + CHUNK), cpseId }, fetchImpl);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { results?: Record<string, string[]> };
      for (const [code, others] of Object.entries(data.results ?? {})) if (others.length > 0) matches.set(code, others);
    }
    return { reachable: true, matches };
  } catch {
    return { reachable: false, matches: new Map() };
  }
}
