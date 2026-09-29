// Tiny JSON persistence layer over localStorage with an in-memory fallback,
// so the same modules work in the browser, in tests (node), and in private
// windows where storage throws. Read failures degrade to the default value;
// write failures are surfaced to the caller (quota errors matter).

const memory = new Map<string, string>();

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage !== null;
  } catch {
    return false;
  }
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = hasLocalStorage() ? localStorage.getItem(key) : memory.get(key) ?? null;
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  if (hasLocalStorage()) localStorage.setItem(key, raw);
  else memory.set(key, raw);
}

export function removeKey(key: string): void {
  if (hasLocalStorage()) localStorage.removeItem(key);
  else memory.delete(key);
}
