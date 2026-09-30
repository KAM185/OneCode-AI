import { vi } from "vitest";

/** Installs a fake localStorage (node has none) BEFORE modules that capture it are imported. */
export function installFakeLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

export const csvFile = (name: string, content: string) => new File([content], name, { type: "text/csv" });
