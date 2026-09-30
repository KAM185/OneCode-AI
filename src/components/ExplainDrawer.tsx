import { useEffect, useMemo, useState } from "react";
import type { MappingEntry, ParsedMaterial } from "../lib/types";
import { explain, textSimilarity, type Status } from "../lib/explain";

const MARK: Record<Status, string> = { same: "✓", compatible: "✓", different: "✗", unknown: "?" };
const COLOR: Record<Status, string> = { same: "var(--success)", compatible: "var(--warning)", different: "var(--danger)", unknown: "var(--text-muted)" };
const WORD: Record<Status, string> = { same: "Same", compatible: "Compatible", different: "Different", unknown: "Unknown" };
const RISK_BADGE: Record<string, string> = { LOW: "success", MEDIUM: "warning", HIGH: "danger" };
const OUT_BADGE = { "AUTO ISSUE": "success", "HUMAN REVIEW": "warning", REJECT: "danger" } as const;
const H = ({ children }: { children: string }) => <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, color: "var(--text-muted)", margin: "18px 0 6px" }}>{children}</p>;

interface Props { entry: MappingEntry; materials: Map<string, ParsedMaterial>; onClose: () => void }

export default function ExplainDrawer({ entry, materials, onClose }: Props) {
  const a = materials.get(entry.materialId);
  const b = entry.decision.matchedMaterialId ? materials.get(entry.decision.matchedMaterialId) : undefined;
  const [sim, setSim] = useState<{ score: number; via: string } | null>(null);

  useEffect(() => {
    let live = true;
    setSim(null);
    if (a && b) textSimilarity(a.rawDescription, b.rawDescription).then((s) => live && setSim({ score: s.score, via: s.via })).catch(() => {});
    return () => { live = false; };
  }, [a, b]);

  const ex = useMemo(() => (a && b ? explain(entry, a, b, sim) : null), [entry, a, b, sim]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,33,46,.35)", zIndex: 50 }}>
      <aside onClick={(e) => e.stopPropagation()} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "min(560px,100%)", background: "var(--surface)", overflowY: "auto", padding: 20, boxShadow: "-4px 0 20px rgba(0,0,0,.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>AI MATCH EXPLANATION</p>
          <button onClick={onClose}>Close</button>
        </div>
        {!a || !b || !ex ? (
          <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>No matched counterpart exists for this record, so there is no pairwise evidence to explain.</p>
        ) : (
          <>
            {[["Material A", a], ["Material B", b]].map(([t, m], i) => (
              <div key={i}>
                <div style={{ border: "0.5px solid var(--border)", borderRadius: 8, padding: 10, marginTop: 10 }}>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>{t as string}</p>
                  <p className="mono" style={{ fontSize: 12, margin: "2px 0" }}>{(m as ParsedMaterial).cpseId} · {(m as ParsedMaterial).ownCode}</p>
                  <p style={{ fontSize: 13, margin: 0 }}>{(m as ParsedMaterial).rawDescription}</p>
                </div>
                {i === 0 && <p style={{ textAlign: "center", margin: "6px 0 0", color: "var(--text-muted)" }}>↕</p>}
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
              <span className="badge accent">{sim ? `${(sim.score * 100).toFixed(0)}% ${sim.via} similarity` : "similarity…"}</span>
              <span className="badge accent">{entry.decision.verdict.replace(/_/g, " ")}</span>
              <span className={`badge ${RISK_BADGE[entry.decision.safetyRisk ?? ""] ?? "accent"}`}>RISK {entry.decision.safetyRisk ?? "not calculated"}</span>
              <span className={`badge ${OUT_BADGE[ex.outcome]}`}>{ex.outcome}</span>
            </div>

            <H>ATTRIBUTE EVIDENCE</H>
            {ex.attrs.filter((x) => x.key !== "dimensions" || ex.attrs.length).map((x) => (
              <div key={x.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                <span>{x.label}</span>
                <span style={{ color: COLOR[x.status] }}>{MARK[x.status]} {WORD[x.status]}{x.a && x.status !== "same" ? ` (${x.a} / ${x.b ?? "—"})` : x.a ? ` · ${x.a}` : ""}</span>
              </div>
            ))}

            <H>AI REASONING</H>
            <p style={{ fontSize: 12, lineHeight: 1.5, margin: 0 }}>{ex.reasoning}</p>

            <H>DECISION LOGIC</H>
            <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>Why {ex.outcome === "AUTO ISSUE" ? "Auto Issue" : ex.outcome === "REJECT" ? "Reject" : "Human Review"}?</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
              {ex.checks.map((c) => <span key={c.label} style={{ color: COLOR[c.status] }} title={c.detail}>{MARK[c.status]} {c.label}</span>)}
            </div>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "6px 0" }}>{ex.outcomeWhy}</p>
            <p style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>Recommendation: {ex.outcome} {ex.outcome === "HUMAN REVIEW" ? "REQUIRED" : ""}</p>

            <H>SAFETY EVIDENCE</H>
            {ex.safety.map((c) => (
              <div key={c.label} style={{ fontSize: 12, padding: "3px 0" }}>
                <span style={{ color: COLOR[c.status] }}>{MARK[c.status]}</span> <b>{c.label}</b> <span style={{ color: "var(--text-secondary)" }}>— {c.detail}</span>
              </div>
            ))}

            <H>MATCH SCORE BREAKDOWN</H>
            {ex.scores.map((s) => (
              <div key={s.label} style={{ fontSize: 12, margin: "5px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{s.label}{s.note ? <span style={{ color: "var(--text-muted)" }}> · {s.note}</span> : null}</span>
                  <span>{s.value === null ? "Not calculated" : `${(s.value * 100).toFixed(0)}%`}</span>
                </div>
                {s.value !== null && <div style={{ height: 6, background: "var(--surface-muted)", borderRadius: 3 }}><div style={{ width: `${s.value * 100}%`, height: 6, background: "var(--accent)", borderRadius: 3 }} /></div>}
              </div>
            ))}

            <H>EVIDENCE TRACE</H>
            {[{ key: "desc", label: "Description", a: a.rawDescription, b: b.rawDescription, role: "Source text every attribute was extracted from" }, ...ex.attrs.filter((x) => x.a !== undefined || x.b !== undefined).filter((x) => !["dimensions"].includes(x.key))].map((x) => (
              <details key={x.key} style={{ fontSize: 12, borderBottom: "0.5px solid var(--border)", padding: "5px 0" }}>
                <summary style={{ cursor: "pointer" }}>{x.label} → <span className="mono">{x.a ?? "—"}</span></summary>
                <div style={{ padding: "6px 0 2px 14px", color: "var(--text-secondary)" }}>
                  <div>Material A: <span className="mono">{x.a ?? "not found"}</span></div>
                  <div>Material B: <span className="mono">{x.b ?? "not found"}</span></div>
                  <div>Role in decision: {x.role}</div>
                  {x.key !== "desc" && <div>Extracted from the description by the shared dictionary ({a.classifiedBy === "ai" ? "AI-assisted classification" : "rules"} for A, {b.classifiedBy === "ai" ? "AI-assisted classification" : "rules"} for B).</div>}
                </div>
              </details>
            ))}
          </>
        )}
      </aside>
    </div>
  );
}
