import type { NmcRecord, ParsedMaterial } from "./types";
import { getSubtype } from "./dictionary";
import { tokenKey, shortHash } from "./text";

// NMC-<CATEGORY>-<SUBTYPE>-<dimensional attrs>-<material attrs>[-<hash>]
//
// Built from canonicalized attributes, not a hash of free text: two CPSEs
// independently processing the same complete, recognized material always
// produce the same code with no coordination needed.
//
// BUG FIX from the previous build: an item with an unrecognized subtype, or
// a recognized subtype missing a required dimensional attribute (e.g. a hex
// nut where no thread size could be parsed), used to collapse to a bare
// "NMC-UNC-UNK" / "NMC-FAS-HNT" code shared by every other such item —
// silently flagging unrelated materials as duplicates of each other. Any
// such "incomplete identity" now has a content hash of its own description
// appended, so it only collides with something that is actually
// near-identical, never with an unrelated item that merely lacks the same
// piece of missing data. `complete: false` on the resulting record is what
// routes these to review instead of auto-duplicate.

function attrPart(attrs: Record<string, string>, keys: string[]): string {
  return keys.map((k) => attrs[k]).filter(Boolean).join("-");
}

export function isIdentityComplete(m: ParsedMaterial): boolean {
  if (m.subtype === "UNK") return false;
  const def = getSubtype(m.subtype);
  if (!def) return false;
  return def.dimAttrs.every((k) => Boolean(m.attrs[k]));
}

export function buildNmcCode(m: ParsedMaterial): string {
  const def = getSubtype(m.subtype);
  const dimPart = def ? attrPart(m.attrs, def.dimAttrs) : "";
  const matPart = def ? attrPart(m.attrs, def.matAttrs) : "";
  const base = ["NMC", m.catCode, m.subtype, dimPart, matPart].filter(Boolean).join("-");

  if (!isIdentityComplete(m)) {
    // Content-hash disambiguation. tokenKey() is order-insensitive so
    // "HEX NUT M12" and "M12 HEX NUT" still hash identically, but two
    // genuinely different unrecognized items will not collide.
    return `${base}-${shortHash(tokenKey(m.rawDescription))}`;
  }
  return base;
}

export function buildCanonicalDescription(m: ParsedMaterial): string {
  const def = getSubtype(m.subtype);
  const parts = [def?.label ?? m.rawDescription.slice(0, 40).toUpperCase()];
  if (def) for (const k of [...def.dimAttrs, ...def.matAttrs]) if (m.attrs[k]) parts.push(m.attrs[k]);
  return parts.join(" ");
}

export function toNmcRecord(m: ParsedMaterial): NmcRecord {
  return {
    nmcCode: buildNmcCode(m),
    canonicalDescription: buildCanonicalDescription(m),
    category: m.category,
    subtype: m.subtype,
    complete: isIdentityComplete(m),
    supersededBy: null,
    createdAt: new Date().toISOString(),
  };
}
