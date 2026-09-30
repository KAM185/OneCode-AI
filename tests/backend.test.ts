import { describe, it, expect, vi } from "vitest";
import { checkAndPublishFingerprints } from "../src/lib/backend";

const okJson = (results: Record<string, string[]>) => new Response(JSON.stringify({ results }), { status: 200 });

describe("checkAndPublishFingerprints (client)", () => {
  it("REGRESSION: sends a handful of batched requests, not one per code", async () => {
    const codes = Array.from({ length: 450 }, (_, i) => `NMC-${i}`);
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      return okJson(Object.fromEntries(body.nmcCodes.map((c: string) => [c, c === "NMC-7" ? ["SAIL"] : []])));
    });
    const r = await checkAndPublishFingerprints(codes, "ONGC", fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 200 + 200 + 50, was 450 requests
    expect(fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string).nmcCodes.length)).toEqual([200, 200, 50]);
    expect(r.reachable).toBe(true);
    expect([...r.matches.entries()]).toEqual([["NMC-7", ["SAIL"]]]);
  });

  it("dedupes codes and posts to the function's default route", async () => {
    const fetchMock = vi.fn(async () => okJson({ A1: [] }));
    await checkAndPublishFingerprints(["A1", "A1", "A1"], "ONGC", fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("/.netlify/functions/fingerprint-index");
  });

  it("reports reachable=false (not 'no matches') when the function is missing, errors, or the network throws", async () => {
    expect((await checkAndPublishFingerprints(["A1"], "ONGC", (async () => new Response("nf", { status: 404 })) as unknown as typeof fetch)).reachable).toBe(false);
    expect((await checkAndPublishFingerprints(["A1"], "ONGC", (async () => new Response("e", { status: 500 })) as unknown as typeof fetch)).reachable).toBe(false);
    expect((await checkAndPublishFingerprints(["A1"], "ONGC", (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)).reachable).toBe(false);
  });

  it("empty input makes no request", async () => {
    const fetchMock = vi.fn();
    const r = await checkAndPublishFingerprints([], "ONGC", fetchMock as unknown as typeof fetch);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.reachable).toBe(true);
  });
});
