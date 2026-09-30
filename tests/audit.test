import { describe, it, expect, beforeEach } from "vitest";
import { installFakeLocalStorage } from "./helpers";

const store = installFakeLocalStorage();
const { appendAuditEntry, appendAuditBatch, loadAuditLog, verifyAuditChain, clearAuditLog } = await import("../src/lib/audit");
import type { Identity } from "../src/lib/identity";

beforeEach(() => { store.clear(); });

async function makeIdentity(id: string): Promise<Identity> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { reviewerId: id, publicKeyJwk: await crypto.subtle.exportKey("jwk", pair.publicKey), privateKey: pair.privateKey };
}

describe("audit log — concurrent appends", () => {
  it("REGRESSION: 50 overlapping fire-and-forget appends ALL persist (previously 1 of 50 survived) and the chain stays valid", async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => appendAuditEntry("code_issued_distinct", { i })));
    const log = loadAuditLog();
    expect(log).toHaveLength(50);
    expect(log.map((e) => e.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect((await verifyAuditChain()).valid).toBe(true);
  });

  it("un-awaited (void) appends — the pattern the pipeline used — also all land", async () => {
    for (let i = 0; i < 40; i++) void appendAuditEntry("x", { i });
    await appendAuditEntry("barrier", {});
    expect(loadAuditLog()).toHaveLength(41);
  });

  it("batch append is one atomic extension with correct chaining", async () => {
    await appendAuditEntry("first", {});
    const added = await appendAuditBatch(Array.from({ length: 25 }, (_, i) => ({ action: "b", details: { i } })));
    expect(added).toHaveLength(25);
    const log = loadAuditLog();
    expect(log).toHaveLength(26);
    for (let i = 1; i < log.length; i++) expect(log[i].prevHash).toBe(log[i - 1].hash);
    expect((await verifyAuditChain()).valid).toBe(true);
  });

  it("an empty batch is a no-op", async () => {
    expect(await appendAuditBatch([])).toEqual([]);
    expect(loadAuditLog()).toHaveLength(0);
  });

  it("one failed append does not wedge the queue", async () => {
    let calls = 0;
    const orig = (globalThis as { localStorage: Storage }).localStorage.setItem;
    (globalThis as { localStorage: Storage }).localStorage.setItem = () => { if (calls++ === 0) throw new Error("QuotaExceededError"); };
    await expect(appendAuditEntry("fails", {})).rejects.toThrow(/Quota/);
    (globalThis as { localStorage: Storage }).localStorage.setItem = orig;
    await appendAuditEntry("recovers", {});
    expect(loadAuditLog().map((e) => e.action)).toEqual(["recovers"]);
  });
});

describe("audit log — signatures and tamper detection", () => {
  it("verifies signed entries and detects a tampered detail, a forged signature, and a broken link", async () => {
    const alice = await makeIdentity("alice");
    const bob = await makeIdentity("bob");
    await appendAuditEntry("review_confirmed", { nmcCode: "NMC-A", linkedNmcCode: "NMC-B" }, [alice, bob]);
    await appendAuditEntry("code_superseded", { oldCode: "NMC-A", newCode: "NMC-C" }, [alice]);
    expect((await verifyAuditChain()).valid).toBe(true);

    const key = "onecode_audit_log_v2";
    const original = store.get(key)!;

    const tampered = JSON.parse(original);
    tampered[0].details.linkedNmcCode = "NMC-EVIL";
    store.set(key, JSON.stringify(tampered));
    expect((await verifyAuditChain()).brokenAt).toBe(0);

    const forged = JSON.parse(original);
    forged[1].signers[0].id = "mallory"; // reattribute — id isn't signed, but the signature must still match the payload
    forged[1].signers[0].pub = forged[0].signers[1].pub; // swap in bob's key
    store.set(key, JSON.stringify(forged));
    expect((await verifyAuditChain()).invalidSignatureAt).toBe(1);

    const cut = JSON.parse(original).slice(1);
    store.set(key, JSON.stringify(cut));
    expect((await verifyAuditChain()).valid).toBe(false);

    clearAuditLog();
    expect((await verifyAuditChain()).valid).toBe(true);
  });
});
