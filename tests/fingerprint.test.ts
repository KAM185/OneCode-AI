import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStore } from "@netlify/blobs";
import { BlobsServer } from "@netlify/blobs/server";
// @ts-expect-error — plain .mjs shared with the Netlify function, no types
import { handleFingerprintRequest, parseRequest, pairKey, withConsistencyFallback, LIMITS } from "../netlify/lib/fingerprint-core.mjs";

// These tests run the REAL function logic against a REAL @netlify/blobs
// client talking HTTP to Netlify's own local Blobs server (the same
// implementation `netlify dev` uses) — not an in-memory fake. What this
// does NOT cover: Netlify's deployed edge (auth, regional latency, the
// function runtime wrapper). That still needs one live smoke test:
// `npm run verify-deploy -- https://<site>.netlify.app`.

let server: InstanceType<typeof BlobsServer>;
let dir: string;
let store: ReturnType<typeof getStore>;
let edgeURL: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "blobs-"));
  server = new BlobsServer({ directory: dir, token: "test-token" });
  const { port } = await server.start();
  edgeURL = `http://localhost:${port}`;
  store = getStore({ name: "nmc-fingerprint-index", siteID: "test-site", token: "test-token", edgeURL, uncachedEdgeURL: edgeURL, consistency: "strong" });
});
afterAll(async () => {
  await server.stop();
  await rm(dir, { recursive: true, force: true });
});

const post = (body: unknown) =>
  handleFingerprintRequest(
    new Request("http://x/.netlify/functions/fingerprint-index", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    store
  );

describe("fingerprint-index (real Blobs server)", () => {
  it("first CPSE sees no others; second CPSE is told about the first", async () => {
    const a = await (await post({ nmcCodes: ["NMC-FAS-HNT-M12-SS304-DIN934"], cpseId: "ONGC" })).json();
    expect(a.results["NMC-FAS-HNT-M12-SS304-DIN934"]).toEqual([]);
    const b = await (await post({ nmcCodes: ["NMC-FAS-HNT-M12-SS304-DIN934"], cpseId: "SAIL" })).json();
    expect(b.results["NMC-FAS-HNT-M12-SS304-DIN934"]).toEqual(["ONGC"]);
  });

  it("is idempotent: re-publishing does not duplicate or self-report", async () => {
    await post({ nmcCodes: ["NMC-X-1"], cpseId: "BHEL" });
    const again = await (await post({ nmcCodes: ["NMC-X-1"], cpseId: "BHEL" })).json();
    expect(again.results["NMC-X-1"]).toEqual([]);
  });

  it("keeps the legacy single-code request/response shape", async () => {
    await post({ nmcCode: "NMC-LEGACY-1", cpseId: "IOCL" });
    const r = await (await post({ nmcCode: "NMC-LEGACY-1", cpseId: "GAIL" })).json();
    expect(r).toEqual({ nmcCode: "NMC-LEGACY-1", otherCpses: ["IOCL"] });
  });

  it("loses no publisher under 12 concurrent writers of the same code (the old read-modify-write lost updates)", async () => {
    const cpses = Array.from({ length: 12 }, (_, i) => `CPSE ${i}`);
    await Promise.all(cpses.map((c) => post({ nmcCodes: ["NMC-RACE-1"], cpseId: c })));
    const probe = await (await post({ nmcCodes: ["NMC-RACE-1"], cpseId: "PROBE" })).json();
    expect(probe.results["NMC-RACE-1"]).toEqual([...cpses].sort());
  });

  it("handles codes containing slashes and dots without key collisions", async () => {
    await post({ nmcCodes: ["NMC-PIP-1/2.5"], cpseId: "ONGC" });
    const other = await (await post({ nmcCodes: ["NMC-PIP-1"], cpseId: "SAIL" })).json();
    expect(other.results["NMC-PIP-1"]).toEqual([]); // prefix of another code is NOT a match
    const same = await (await post({ nmcCodes: ["NMC-PIP-1/2.5"], cpseId: "SAIL" })).json();
    expect(same.results["NMC-PIP-1/2.5"]).toEqual(["ONGC"]);
  });

  it("serves a large batch in one request", async () => {
    const codes = Array.from({ length: 300 }, (_, i) => `NMC-BULK-${i}`);
    const res = await post({ nmcCodes: codes, cpseId: "NTPC" });
    expect(res.status).toBe(200);
    expect(Object.keys((await res.json()).results)).toHaveLength(300);
  });
});

describe("fingerprint-index — input validation", () => {
  it("rejects non-POST, bad JSON, missing/invalid fields, oversize batches", async () => {
    expect((await handleFingerprintRequest(new Request("http://x", { method: "GET" }), store)).status).toBe(405);
    expect((await handleFingerprintRequest(new Request("http://x", { method: "POST", body: "{nope" }), store)).status).toBe(400);
    expect((await post({ nmcCodes: ["A"] })).status).toBe(400);
    expect((await post({ cpseId: "ONGC" })).status).toBe(400);
    expect((await post({ nmcCodes: ["bad code with spaces"], cpseId: "ONGC" })).status).toBe(400);
    expect((await post({ nmcCodes: ["../etc"], cpseId: "ONGC" })).status).toBe(400);
    expect((await post({ nmcCodes: ["A".repeat(LIMITS.maxCodeLength + 1)], cpseId: "ONGC" })).status).toBe(400);
    expect((await post({ nmcCodes: Array.from({ length: LIMITS.maxCodesPerRequest + 1 }, (_, i) => `C${i}`), cpseId: "ONGC" })).status).toBe(400);
    expect((await post({ nmcCodes: ["A1"], cpseId: "x/y" })).status).toBe(400);
  });

  it("parseRequest dedupes codes and pairKey encodes separators", () => {
    expect(parseRequest({ nmcCodes: ["A1", "A1", "B2"], cpseId: "COAL INDIA" }).codes).toEqual(["A1", "B2"]);
    expect(pairKey("NMC-1/2", "COAL INDIA")).toBe("NMC-1%2F2/COAL%20INDIA");
  });

  it("falls back to the default store when strong consistency isn't configured (real BlobsConsistencyError)", async () => {
    const strongMisconfigured = getStore({ name: "nmc-fingerprint-index", siteID: "test-site", token: "test-token", edgeURL, consistency: "strong" }); // no uncachedEdgeURL
    await expect(strongMisconfigured.list({ prefix: "x/" })).rejects.toThrow(/uncachedEdgeURL/);
    const eventual = getStore({ name: "nmc-fingerprint-index", siteID: "test-site", token: "test-token", edgeURL });
    const wrapped = withConsistencyFallback(strongMisconfigured, eventual);
    const req = (cpseId: string) => new Request("http://x", { method: "POST", body: JSON.stringify({ nmcCodes: ["NMC-FALLBACK-1"], cpseId }) });
    expect((await handleFingerprintRequest(req("ONGC"), wrapped)).status).toBe(200);
    const r = await (await handleFingerprintRequest(req("SAIL"), wrapped)).json();
    expect(r.results["NMC-FALLBACK-1"]).toEqual(["ONGC"]);
  });

  it("returns 500 (not a crash) when the store is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined); // the handler logs store failures; keep test output clean
    const broken = { list: async () => { throw new Error("down"); }, set: async () => { throw new Error("down"); } };
    const res = await handleFingerprintRequest(
      new Request("http://x", { method: "POST", body: JSON.stringify({ nmcCodes: ["A1"], cpseId: "ONGC" }) }),
      broken
    );
    expect(res.status).toBe(500);
  });
});
