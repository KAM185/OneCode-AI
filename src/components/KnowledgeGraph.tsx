import { useEffect, useMemo, useRef, useState } from "react";
import { buildGraph, auditCounts, nmcProfile, cpseId, matId, nmcId, type GNode, type NodeType, type RelType } from "../lib/graph";
import { loadAuditLog, verifyAuditChain } from "../lib/audit";
import type { SupersessionMap } from "../lib/registry";
import type { PipelineResult, SubstitutionLink } from "../lib/types";

const COLORS = { ok: "#1f6feb", review: "#d29922", risk: "#d1242f" };
const FILL: Record<NodeType, string> = { cpse: "#1f6feb", material: "#ffffff", nmc: "#2da44e", substitute: "#d29922", superseded: "#8b949e" };
const TYPE_NAME: Record<NodeType, string> = { cpse: "CPSE", material: "Legacy material", nmc: "Canonical NMC", substitute: "Substitute material", superseded: "Superseded material" };
const GLYPH: Record<NodeType, string> = { cpse: "C", material: "M", nmc: "N", substitute: "S", superseded: "✕" };
const RELS: RelType[] = ["USED_BY", "DUPLICATE", "FUNCTIONALLY_EQUIVALENT", "MAPPED_TO", "SUBSTITUTE", "SUPERSEDES", "SUPERSEDED_BY"];
const DASH: Record<RelType, string | undefined> = { USED_BY: undefined, DUPLICATE: undefined, FUNCTIONALLY_EQUIVALENT: "6 3", MAPPED_TO: "2 3", SUBSTITUTE: "8 3 2 3", SUPERSEDES: "10 4", SUPERSEDED_BY: "10 4" };
const REL_LABEL = (r: RelType) => r === "MAPPED_TO" ? "mapped to" : r.toLowerCase().replace(/_/g, " ");

function Shape({ n, r = 13 }: { n: GNode; r?: number }) {
  const stroke = n.type === "cpse" ? "#0b3d91" : COLORS[n.health], sw = n.health === "ok" ? 1.5 : 3;
  const common = { fill: FILL[n.type], stroke, strokeWidth: sw, strokeDasharray: n.type === "superseded" ? "3 2" : undefined };
  const p = (pts: number) => Array.from({ length: pts }, (_, i) => { const a = (Math.PI * 2 * i) / pts - Math.PI / 2; return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`; }).join(" ");
  const s = n.type === "cpse" ? <rect x={-r} y={-r} width={2 * r} height={2 * r} rx={4} {...common} />
    : n.type === "nmc" ? <polygon points={p(6)} {...common} transform="scale(1.15)" />
    : n.type === "substitute" ? <polygon points={`0,${-r * 1.25} ${r * 1.25},0 0,${r * 1.25} ${-r * 1.25},0`} {...common} />
    : n.type === "superseded" ? <polygon points={p(8)} {...common} />
    : <circle r={r * 0.8} {...common} />;
  return <>{s}<text textAnchor="middle" dy="0.35em" fontSize={10} fontWeight={700} fill={n.type === "material" ? "#333" : "#fff"} style={{ pointerEvents: "none" }}>{GLYPH[n.type]}</text>
    {n.health !== "ok" && <g transform={`translate(${r},${-r})`}><circle r={6} fill={COLORS[n.health]} stroke="#fff" /><text textAnchor="middle" dy="0.35em" fontSize={9} fontWeight={700} fill="#fff" style={{ pointerEvents: "none" }}>{n.health === "risk" ? "!" : "?"}</text></g>}</>;
}

interface Props { result: PipelineResult; links: SubstitutionLink[]; supersessions: SupersessionMap; onOpenProfile?: (nmcCode: string) => void }

export default function KnowledgeGraph({ result, links, supersessions, onOpenProfile }: Props) {
  const graph = useMemo(() => buildGraph(result, links, supersessions), [result, links, supersessions]);
  const audit = useMemo(() => auditCounts(loadAuditLog(), new Set(graph.nodes.filter((n) => n.id.startsWith("n:")).map((n) => n.label))), [graph]);
  const [chainOk, setChainOk] = useState<boolean | null>(null);
  useEffect(() => { verifyAuditChain().then((r) => setChainOk(r.valid)).catch(() => setChainOk(null)); }, [graph]);

  const [rels, setRels] = useState<Set<RelType>>(new Set(RELS));
  const [cpse, setCpse] = useState(""); const [cat, setCat] = useState(""); const [status, setStatus] = useState(""); const [nmcQ, setNmcQ] = useState(""); const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null); const [hover, setHover] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const W = 900, H = 560;

  const cpses = useMemo(() => graph.nodes.filter((n) => n.type === "cpse").map((n) => n.label).sort(), [graph]);
  const cats = useMemo(() => [...new Set(graph.nodes.filter((n) => n.type !== "cpse").map((n) => n.category))].sort(), [graph]);
  const statuses = useMemo(() => [...new Set(graph.nodes.filter((n) => n.type !== "cpse").map((n) => n.status))].sort(), [graph]);

  // Fit view whenever the graph changes.
  useEffect(() => {
    if (!graph.nodes.length) return;
    const xs = graph.nodes.map((n) => n.x), ys = graph.nodes.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min(1.5, 0.9 * Math.min(W / (x1 - x0 + 60), H / (y1 - y0 + 60)));
    setView({ k, x: W / 2 - ((x0 + x1) / 2) * k, y: H / 2 - ((y0 + y1) / 2) * k }); setSel(null);
  }, [graph]);

  const visible = useMemo(() => {
    const keep = new Set<string>();
    const nq = nmcQ.trim().toLowerCase();
    for (const n of graph.nodes) {
      if (n.type === "cpse") { if (!cpse || n.label === cpse) keep.add(n.id); continue; }
      if (cat && n.category !== cat) continue;
      if (status && n.status !== status) continue;
      if (nq && n.id.startsWith("n:") && !n.label.toLowerCase().includes(nq)) continue;
      keep.add(n.id);
    }
    let edges = graph.edges.filter((e) => rels.has(e.rel) && keep.has(e.from) && keep.has(e.to));
    if (cpse) { // only keep materials/NMCs reachable from the chosen CPSE's materials
      const own = new Set(edges.filter((e) => e.rel === "USED_BY" && e.to === cpseId(cpse)).map((e) => e.from));
      const nm = new Set(graph.edges.filter((e) => own.has(e.from) && e.to.startsWith("n:")).map((e) => e.to));
      const ok = (id: string) => id === cpseId(cpse) || own.has(id) || nm.has(id) || (id.startsWith("n:") && graph.edges.some((e) => (nm.has(e.from) && e.to === id) || (nm.has(e.to) && e.from === id)));
      edges = edges.filter((e) => ok(e.from) && ok(e.to));
    }
    const used = new Set<string>(); edges.forEach((e) => { used.add(e.from); used.add(e.to); });
    return { edges, ids: used };
  }, [graph, rels, cpse, cat, status, nmcQ]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? new Set(graph.nodes.filter((n) => visible.ids.has(n.id) && (n.label.toLowerCase().includes(s) || n.title.toLowerCase().includes(s))).map((n) => n.id)) : null;
  }, [q, graph, visible]);

  const focus = (id: string) => { const n = graph.byId.get(id); if (n) setView((v) => ({ ...v, x: W / 2 - n.x * v.k, y: H / 2 - n.y * v.k })); };
  const neighbor = useMemo(() => {
    const s = new Set<string>(); const f = sel ?? hover; if (!f) return s;
    visible.edges.forEach((e) => { if (e.from === f) s.add(e.to); if (e.to === f) s.add(e.from); }); s.add(f); return s;
  }, [sel, hover, visible]);
  const showAllLabels = visible.edges.length <= 120 || view.k > 1.4;

  const selNode = sel ? graph.byId.get(sel) ?? null : null;
  const hovNode = hover ? graph.byId.get(hover) ?? null : null;
  const toggleRel = (r: RelType) => setRels((p) => { const n = new Set(p); n.has(r) ? n.delete(r) : n.add(r); return n; });
  const sty = { fontSize: 12, padding: "4px 6px" } as const;

  return (
    <div className="panel">
      <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>Material Knowledge Graph</p>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 10px" }}>
        Every node and edge is projected from this run's mappings, the persisted substitution table, the supersession registry and the audit log. {graph.nodes.length} nodes · {visible.edges.length} of {graph.edges.length} relationships shown.
      </p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <input placeholder="Search graph…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && matches?.size) { const id = [...matches][0]; setSel(id); focus(id); } }} style={sty} />
        <input placeholder="Filter NMC…" value={nmcQ} onChange={(e) => setNmcQ(e.target.value)} style={sty} />
        <select value={cpse} onChange={(e) => setCpse(e.target.value)} style={sty}><option value="">All CPSEs</option>{cpses.map((c) => <option key={c}>{c}</option>)}</select>
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={sty}><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={sty}><option value="">All statuses</option>{statuses.map((c) => <option key={c}>{c}</option>)}</select>
        <button onClick={() => setView((v) => ({ ...v, k: v.k * 1.25 }))} style={sty}>＋</button>
        <button onClick={() => setView((v) => ({ ...v, k: v.k / 1.25 }))} style={sty}>－</button>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8, fontSize: 11 }}>
        {RELS.map((r) => <label key={r} style={{ display: "flex", gap: 3, alignItems: "center" }}><input type="checkbox" checked={rels.has(r)} onChange={() => toggleRel(r)} />{REL_LABEL(r)}</label>)}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 520px", border: "1px solid var(--border, #d0d7de)", borderRadius: 6, overflow: "hidden", background: "var(--bg, #fff)" }}>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", cursor: drag.current ? "grabbing" : "grab", touchAction: "none" }}
            onWheel={(e) => { const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; const r = e.currentTarget.getBoundingClientRect(); const mx = ((e.clientX - r.left) / r.width) * W, my = ((e.clientY - r.top) / r.height) * H;
              setView((v) => { const k = Math.max(0.1, Math.min(6, v.k * f)); return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k }; }); }}
            onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; }}
            onPointerMove={(e) => { const d = drag.current; if (!d) return; const sc = W / e.currentTarget.getBoundingClientRect().width; const mx = (e.clientX - d.x) * sc, my = (e.clientY - d.y) * sc; if (Math.abs(mx) + Math.abs(my) > 3) d.moved = true; if (d.moved) setView((v) => ({ ...v, x: d.vx + mx, y: d.vy + my })); }}
            onPointerUp={() => { const m = drag.current?.moved; drag.current = null; if (!m) setSel(null); }}>
            <defs><marker id="kg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#8b949e" /></marker></defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {visible.edges.map((e) => {
                const a = graph.byId.get(e.from)!, b = graph.byId.get(e.to)!;
                const dim = (sel || hover) && !(neighbor.has(e.from) && neighbor.has(e.to) && (e.from === (sel ?? hover) || e.to === (sel ?? hover)));
                const lab = showAllLabels || (!dim && (sel ?? hover) && (e.from === (sel ?? hover) || e.to === (sel ?? hover)));
                // curve mirrored pairs (SUPERSEDES / SUPERSEDED_BY) so both are readable
                const off = e.rel === "SUPERSEDES" ? 14 : e.rel === "SUPERSEDED_BY" ? -14 : 0;
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
                const cx = mx - (dy / d) * off, cy = my + (dx / d) * off;
                return <g key={e.id} opacity={dim ? 0.08 : 1}>
                  <path d={`M${a.x} ${a.y}Q${cx} ${cy} ${b.x} ${b.y}`} fill="none" stroke="#8b949e" strokeWidth={e.rel === "SUBSTITUTE" ? 2 : 1.2} strokeDasharray={DASH[e.rel]} markerEnd="url(#kg-arrow)" />
                  {lab && <text x={cx} y={cy - 2} fontSize={8} textAnchor="middle" fill="#57606a" stroke="#fff" strokeWidth={2.5} paintOrder="stroke">{REL_LABEL(e.rel)}</text>}
                </g>;
              })}
              {graph.nodes.filter((n) => visible.ids.has(n.id)).map((n) => {
                const dim = ((sel || hover) && !neighbor.has(n.id)) || (matches && !matches.has(n.id));
                const hit = matches?.has(n.id);
                return <g key={n.id} transform={`translate(${n.x} ${n.y})`} opacity={dim ? 0.15 : 1} style={{ cursor: "pointer" }}
                  onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setSel(n.id); setFull(false); }}
                  onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}>
                  {hit && <circle r={20} fill="none" stroke="#bf8700" strokeWidth={2} strokeDasharray="3 2" />}
                  <Shape n={n} />
                  {(n.type !== "material" || view.k > 1.2 || sel === n.id) && <text y={26} fontSize={9} textAnchor="middle" fill="#24292f" stroke="#fff" strokeWidth={2.5} paintOrder="stroke">{n.label}</text>}
                </g>;
              })}
            </g>
          </svg>
          {hovNode && hovNode.id !== sel && (
            <div style={{ position: "absolute", left: 8, bottom: 8, background: "#fff", border: "1px solid #d0d7de", borderRadius: 6, padding: "6px 8px", fontSize: 11, maxWidth: 260, boxShadow: "0 2px 8px rgba(0,0,0,.15)", pointerEvents: "none" }}>
              <b>{hovNode.label}</b> · {TYPE_NAME[hovNode.type]}<br />{hovNode.title}<br />
              {hovNode.type !== "cpse" && <>Category: {hovNode.category} · Status: {hovNode.status}<br /></>}
              Links: {visible.edges.filter((e) => e.from === hovNode.id || e.to === hovNode.id).length}
            </div>
          )}
          {visible.edges.length === 0 && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-muted)" }}>No relationships match the current filters.</div>}
        </div>

        <div style={{ flex: "1 1 240px", minWidth: 240, fontSize: 12 }}>
          {selNode ? <Insight node={selNode} result={result} links={links} sup={supersessions} audit={audit} chainOk={chainOk} full={full}
            onFull={() => { setFull(true); if (selNode.id.startsWith("n:")) onOpenProfile?.(selNode.label); }} onSelect={(id) => { setSel(id); focus(id); setFull(false); }} />
            : <p style={{ color: "var(--text-muted)", margin: 0 }}>Click a node to open its Material 360° panel. Scroll to zoom, drag to pan, Enter in search jumps to the first match.</p>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 11, color: "var(--text-secondary)" }}>
        {(Object.keys(TYPE_NAME) as NodeType[]).map((t) => <span key={t} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width={30} height={30} viewBox="-15 -15 30 30"><Shape n={{ id: t, type: t, label: "", title: "", category: "", health: "ok", status: "", x: 0, y: 0 }} r={10} /></svg>{TYPE_NAME[t]}</span>)}
        <span>Ring/badge: <b style={{ color: COLORS.review }}>?</b> review / substitution · <b style={{ color: COLORS.risk }}>!</b> risk or rejected</span>
        <span>Fill: blue = CPSE, white = material, green = canonical NMC, amber = substitute, grey = superseded</span>
        <span>Line style encodes relationship type; labels name it.</span>
      </div>
    </div>
  );
}

function Insight({ node, result, links, sup, audit, chainOk, full, onFull, onSelect }: { node: GNode; result: PipelineResult; links: SubstitutionLink[]; sup: SupersessionMap; audit: Map<string, number>; chainOk: boolean | null; full: boolean; onFull: () => void; onSelect: (id: string) => void }) {
  const row = (k: string, v: React.ReactNode) => <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}><span style={{ color: "var(--text-secondary)" }}>{k}</span><span style={{ textAlign: "right" }}>{v}</span></div>;
  const head = <><p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, margin: 0, color: "var(--text-muted)" }}>MATERIAL 360° · {TYPE_NAME[node.type].toUpperCase()}</p>
    <p style={{ fontWeight: 600, fontSize: 13, margin: "2px 0 8px" }}><span className="mono">{node.label}</span> {node.title}</p></>;

  if (node.type === "cpse") {
    const es = result.mapping.filter((e) => e.cpseId === node.label);
    const mine = new Set(es.map((e) => e.nmcCode));
    const shared = new Set<string>(); for (const e of result.mapping) if (e.cpseId !== node.label && mine.has(e.nmcCode)) shared.add(e.cpseId);
    return <div>{head}{row("Legacy materials", es.length)}{row("Distinct NMC codes", mine.size)}{row("Shares NMCs with", shared.size ? [...shared].join(", ") : "none")}{row("Pending review", es.filter((e) => e.status === "pending-review").length)}
      <p style={{ margin: "6px 0 2px", color: "var(--text-secondary)" }}>NMCs:</p><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{[...mine].slice(0, 30).map((c) => <button key={c} style={{ fontSize: 11, padding: "1px 5px" }} onClick={() => onSelect(nmcId(c))}>{c}</button>)}</div></div>;
  }
  if (node.type === "material") {
    const e = result.mapping.find((m) => matId(m.materialId) === node.id);
    if (!e) return <div>{head}</div>;
    return <div>{head}{row("CPSE", <button style={{ fontSize: 11, padding: "1px 5px" }} onClick={() => onSelect(cpseId(e.cpseId))}>{e.cpseId}</button>)}{row("UoM", e.uom || "—")}
      {row("Mapped to", <button className="mono" style={{ fontSize: 11, padding: "1px 5px" }} onClick={() => onSelect(nmcId(e.nmcCode))}>{e.nmcCode}</button>)}
      {e.currentNmcCode && row("Current code", e.currentNmcCode)}{row("Verdict", `${e.decision.verdict} (${Math.round(e.decision.confidence * 100)}%, ${e.decision.stage})`)}
      {row("Safety risk", e.decision.safetyRisk ?? "none flagged")}{row("Status", e.status)}{e.decision.auditSeq != null && row("Audit seq", `#${e.decision.auditSeq}`)}
      <ul style={{ margin: "6px 0 0", paddingLeft: 16, color: "var(--text-secondary)" }}>{e.decision.reasons.slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}</ul></div>;
  }
  const p = nmcProfile(node.label, result, links, sup, audit);
  const chip = (c: string) => <button key={c} className="mono" style={{ fontSize: 11, padding: "1px 5px", marginLeft: 3 }} onClick={() => onSelect(nmcId(c))}>{c}</button>;
  const auditStatus = p.auditEntries === 0 ? "NO ENTRIES" : chainOk === null ? "CHECKING…" : chainOk ? "VERIFIED" : "CHAIN BROKEN";
  return <div>{head}
    {row("Used by", p.usedBy.length ? p.usedBy.join(" ") : "— (registry only)")}{row("Legacy codes", p.legacyCodes)}{row("Duplicates", p.duplicates)}{row("Equivalent materials", p.equivalents)}
    {row("Approved substitutes", p.substitutes.length ? <>{p.substitutes.length}{p.substitutes.map(chip)}</> : 0)}
    {row("Superseded codes", p.supersededCodes.length ? <>{p.supersededCodes.length}{p.supersededCodes.map(chip)}</> : 0)}
    {p.supersededBy && row("Superseded by", chip(p.supersededBy))}
    {row("Review decisions", p.reviewDecisions)}{row("Audit status", <span className={`badge ${auditStatus === "VERIFIED" ? "success" : auditStatus === "CHAIN BROKEN" ? "danger" : ""}`}>{auditStatus} · {p.auditEntries}</span>)}
    <button style={{ marginTop: 8, width: "100%" }} onClick={onFull}>Open Full Material Profile</button>
    {full && <div style={{ marginTop: 8, maxHeight: 260, overflow: "auto" }}>
      <p style={{ fontSize: 11, margin: "0 0 4px", color: "var(--text-secondary)" }}>Category: {node.category} · Status: {node.status}{sup[node.label] ? ` · Superseded: ${sup[node.label].reason}` : ""}</p>
      {p.members.length === 0 ? <p style={{ color: "var(--text-muted)" }}>No legacy materials mapped in this run; known from the persisted registries.</p> :
        <table><thead><tr><th>CPSE</th><th>Own code</th><th>Verdict</th><th>Status</th></tr></thead><tbody>{p.members.map((m) => <tr key={m.materialId}><td>{m.cpseId}</td><td className="mono">{m.ownCode}</td><td>{m.decision.verdict}</td><td>{m.status}</td></tr>)}</tbody></table>}
      {links.filter((l) => l.codeA === node.label || l.codeB === node.label).map((l) => <p key={l.id} style={{ margin: "4px 0 0" }}>Substitute link {l.codeA} ↔ {l.codeB}: {l.verdict}, risk {l.safetyRisk ?? "none"}, validated by {l.confirmedBy.join(", ") || "—"}</p>)}
    </div>}
  </div>;
}
