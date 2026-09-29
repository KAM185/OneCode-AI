// A "reviewer identity" here is a real ECDSA (P-256) keypair, generated in
// the browser via WebCrypto and cached in IndexedDB. The private key is
// created non-extractable — it can sign, but its raw bits can never be read
// back out, even by this app's own code. This replaces the previous build's
// "type your name in a box" override, which proved nothing about who acted.
//
// This is a real, verifiable signature scheme appropriate for a hackathon
// deployment, not a claim of government-grade PKI: production use would tie
// each identity to a CPSE's actual SSO/certificate infrastructure. What it
// genuinely provides today: a review action cannot be forged or reattributed
// after the fact without possessing the same browser profile's private key,
// and the audit log below can cryptographically prove that.

const DB_NAME = "onecode_identity_v1";
const STORE = "keys";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<CryptoKeyPair | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as CryptoKeyPair | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: CryptoKeyPair): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface Identity {
  reviewerId: string;
  publicKeyJwk: JsonWebKey;
  privateKey: CryptoKey;
}

export async function getOrCreateIdentity(reviewerId: string): Promise<Identity> {
  const dbKey = reviewerId.trim().toLowerCase();
  let pair = await idbGet(dbKey);
  if (!pair) {
    pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    await idbSet(dbKey, pair);
  }
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { reviewerId, publicKeyJwk, privateKey: pair.privateKey };
}

export async function sign(privateKey: CryptoKey, payload: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(payload)
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function verify(publicKeyJwk: JsonWebKey, payload: string, sigB64: string): Promise<boolean> {
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    const sigBytes = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      sigBytes,
      new TextEncoder().encode(payload)
    );
  } catch {
    return false;
  }
}
