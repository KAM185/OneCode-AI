import type { AuditEntry, MappingEntry, PipelineResult, SubstitutionLink } from "./types";
import type { SupersessionMap } from "./registry";

// Material Knowledge Graph — a pure projection of data the app already holds
// (pipeline mapping, NMC records, substitution registry, supersession registry,
// audit log). Nothing here is inferred or invented.

export type NodeType = "cpse" | "material" | "nmc" | "substitute" | "superseded";
export type RelType = "DUPLICATE" | "FUNCTIONALLY_EQUIVALENT" | "USED_BY" | "SUBSTITUTE" | "SUPERSEDES" | "SUPERSEDED_BY" | "MAPPED_TO";
export type Health = "ok" | "review" | "risk";

export interface GNode {
  id: string;
  type: NodeType;
  label: string;
  title: string;
  category: string;
  health: Health;
  status: string;
  x: number;
  y: number;
}
export interface GEdge { id: string; from: string; to: string; rel: RelType }
export interface Graph { nodes: GNode[]; edges: GEdge[]; byId: Map<string, GNode> }

export const cpseId = (id: string) => `c:${id}`;
export const matId = (id: string) => `m:${id}`;
export const nmcId = (code: string) => `n:${code}`;

const worse = (a: Health, b: Health): Health => (a === "risk" || b === "risk" ? "risk" : a === "review" || b === "review" ? "review" : "ok");

function entryHealth(e: MappingEntry): Health {
  if (e.status === "reviewed-rejected" || e.decision.safetyRisk === "HIGH") return "risk";
  if (e.status === "pending-review") return "review";
  return "ok";
}

export function buildGraph(result: PipelineResult, links: SubstitutionLink[], sup: SupersessionMap): Graph {
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  const rec = new Map(result.records.map((r) => [r.nmcCode, r]));
  const mapped = new Set(result.mapping.map((e) => e.nmcCode));
  const add = (n: Omit<GNode, "x" | "y">) => { if (!nodes.has(n.id)) nodes.set(n.id, { ...n, x: 0, y: 0 }); return nodes.get(n.id)!; };
  const edge = (from: string, to: string, rel: RelType) => { const id = `${from}|${rel}|${to}`; if (!edges.has(id)) edges.set(id, { id, from, to, rel }); };
  const ensureNmc = (code: string) => {
    const r = rec.get(code);
    const isSup = !!sup[code] || !!r?.supersededBy;
    const type: NodeType = isSup ? "superseded" : mapped.has(code) || !links.some((l) => l.codeA === code || l.codeB === code) ? "nmc" : "substitute";
    return add({ id: nmcId(code), type, label: code, title: r?.canonicalDescription ?? "(not in current run)", category: r?.category ?? "Unknown", health: isSup || type === "substitute" ? "review" : "ok", status: isSup ? "superseded" : type === "substitute" ? "substitute-only" : "active" });
  };

  for (const e of result.mapping) {
    const c = add({ id: cpseId(e.cpseId), type: "cpse", label: e.cpseId, title: "CPSE", category: "—", health: "ok", status: "active" });
    const n = ensureNmc(e.nmcCode);
    const h = entryHealth(e);
    n.health = worse(n.health, h);
    if (e.status === "pending-review" && n.status === "active") n.status = "pending-review";
    if (e.status === "reviewed-rejected" && n.status === "active") n.status = "rejected";
    const m = add({ id: matId(e.materialId), type: "material", label: e.ownCode || e.materialId, title: e.description, category: rec.get(e.nmcCode)?.category ?? "Unknown", health: h, status: e.status });
    c.health = worse(c.health, h === "risk" ? "review" : "ok");
    edge(m.id, c.id, "USED_BY");
    const v = e.decision.verdict;
    edge(m.id, n.id, v === "duplicate" ? "DUPLICATE" : v === "functionally_equivalent" ? "FUNCTIONALLY_EQUIVALENT" : "MAPPED_TO");
  }
  for (const l of links) { ensureNmc(l.codeA); ensureNmc(l.codeB); edge(nmcId(l.codeA), nmcId(l.codeB), "SUBSTITUTE"); }
  for (const s of Object.values(sup)) { ensureNmc(s.oldCode); ensureNmc(s.newCode); edge(nmcId(s.oldCode), nmcId(s.newCode), "SUPERSEDED_BY"); edge(nmcId(s.newCode), nmcId(s.oldCode), "SUPERSEDES"); }

  const list = [...nodes.values()];
  layout(list, [...edges.values()]);
  return { nodes: list, edges: [...edges.values()], byId: nodes };
}

/** Deterministic force layout run once per data change; filters only hide. */
function layout(nodes: GNode[], edges: GEdge[]) {
  const n = nodes.length; if (!n) return;
  const idx = new Map(nodes.map((v, i) => [v.id, i]));
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const R = 60 * Math.sqrt(n);
  nodes.forEach((v) => { v.x = (rnd() - 0.5) * R; v.y = (rnd() - 0.5) * R; });
  const E = edges.map((e) => [idx.get(e.from)!, idx.get(e.to)!] as const);
  const iters = Math.max(15, Math.min(250, Math.floor(3e7 / (n * n))));
  const dx = new Float64Array(n), dy = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    dx.fill(0); dy.fill(0);
    const cool = 1 - it / iters;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let ax = nodes[i].x - nodes[j].x, ay = nodes[i].y - nodes[j].y;
      let d2 = ax * ax + ay * ay; if (d2 < 1) { ax = rnd() - 0.5; ay = rnd() - 0.5; d2 = 1; }
      if (d2 > 90000) continue;
      const f = 9000 / d2; dx[i] += ax * f / Math.sqrt(d2); dy[i] += ay * f / Math.sqrt(d2); dx[j] -= ax * f / Math.sqrt(d2); dy[j] -= ay * f / Math.sqrt(d2);
    }
    for (const [a, b] of E) {
      const ax = nodes[b].x - nodes[a].x, ay = nodes[b].y - nodes[a].y, d = Math.sqrt(ax * ax + ay * ay) || 1;
      const f = (d - 110) * 0.04; dx[a] += ax / d * f; dy[a] += ay / d * f; dx[b] -= ax / d * f; dy[b] -= ay / d * f;
    }
    for (let i = 0; i < n; i++) {
      dx[i] -= nodes[i].x * 0.01; dy[i] -= nodes[i].y * 0.01;
      const m = Math.hypot(dx[i], dy[i]) || 1, cap = Math.min(m, 40 * cool + 2);
      nodes[i].x += dx[i] / m * cap; nodes[i].y += dy[i] / m * cap;
    }
  }
}

export interface Profile {
  usedBy: string[];
  legacyCodes: number;
  duplicates: number;
  equivalents: number;
  substitutes: string[];
  supersededCodes: string[];
  supersededBy: string | null;
  reviewDecisions: number;
  auditEntries: number;
  members: MappingEntry[];
}

/** Count audit entries whose details reference each NMC code (string values only). */
export function auditCounts(log: AuditEntry[], codes: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of log) {
    const seen = new Set<string>();
    for (const v of Object.values(a.details)) for (const x of Array.isArray(v) ? v : [v]) if (typeof x === "string" && codes.has(x)) seen.add(x);
    for (const c of seen) out.set(c, (out.get(c) ?? 0) + 1);
  }
  return out;
}

export function nmcProfile(code: string, result: PipelineResult, links: SubstitutionLink[], sup: SupersessionMap, audit: Map<string, number>): Profile {
  const members = result.mapping.filter((e) => e.nmcCode === code);
  const subs = new Set<string>();
  for (const l of links) { if (l.codeA === code) subs.add(l.codeB); else if (l.codeB === code) subs.add(l.codeA); }
  return {
    usedBy: [...new Set(members.map((m) => m.cpseId))],
    legacyCodes: new Set(members.map((m) => `${m.cpseId}/${m.ownCode}`)).size,
    duplicates: members.filter((m) => m.decision.verdict === "duplicate").length,
    equivalents: members.filter((m) => m.decision.verdict === "functionally_equivalent").length,
    substitutes: [...subs],
    supersededCodes: Object.values(sup).filter((s) => s.newCode === code).map((s) => s.oldCode),
    supersededBy: sup[code]?.newCode ?? null,
    reviewDecisions: members.filter((m) => m.status === "reviewed-confirmed" || m.status === "reviewed-rejected").length,
    auditEntries: audit.get(code) ?? 0,
    members,
  };
}
