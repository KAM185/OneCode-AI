import { useEffect, useMemo, useRef, useState } from "react";
import ExplainDrawer from "./ExplainDrawer";
import { scenarioPairs, SCENARIO_NAME } from "../lib/validationData";
import {
  TRUTHS, binCell, computeMetrics, computeSafety, confusion, datasetSummary, evaluateAi, evaluateBaseline, explainInput,
  parseValidationFile, type BinCell, type EvalRow, type GroundTruth, type LabelledPair,
} from "../lib/validation";

const NA = "Insufficient validation data";
const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const word = (t: string) => t.replace(/_/g, " ").toLowerCase();
const BIN_TEXT: Record<BinCell, string> = { TP: "True positive", TN: "True negative", FP: "False positive", FN: "False negative" };
const BIN_DESC: Record<BinCell, string> = {
  TP: "AI: equivalent · Truth: equivalent", TN: "AI: not equivalent · Truth: not equivalent",
  FP: "AI: equivalent · Truth: not equivalent", FN: "AI: not equivalent · Truth: equivalent",
};
type Sel = { kind: "cell"; truth: GroundTruth; pred: GroundTruth } | { kind: "bin"; cell: BinCell } | null;

interface Props { confirmedLinks: number; onDatasetSize?: (n: number) => void }

export default function ValidationLab({ confirmedLinks, onDatasetSize }: Props) {
  const [name, setName] = useState(SCENARIO_NAME);
  const [pairs, setPairs] = useState<LabelledPair[]>(scenarioPairs);
  const [rows, setRows] = useState<EvalRow[] | null>(null);
  const [base, setBase] = useState<EvalRow[] | null>(null);
  const [times, setTimes] = useState<{ ai: number; base: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [sel, setSel] = useState<Sel>(null);
  const [explaining, setExplaining] = useState<EvalRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { onDatasetSize?.(pairs.length); }, [pairs, onDatasetSize]);

  useEffect(() => {
    let live = true;
    setBusy(true); setSel(null);
    evaluateAi(pairs).then((ai) => {
      if (!live) return;
      const b = evaluateBaseline(pairs);
      setRows(ai.rows); setBase(b.rows); setTimes({ ai: ai.ms, base: b.ms });
    }).catch((e) => live && setErrors([`Validation failed: ${e instanceof Error ? e.message : String(e)}`]))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [pairs]);

  async function onImport(f: File | undefined) {
    if (!f) return;
    try {
      const r = await parseValidationFile(f);
      setErrors(r.errors);
      if (r.pairs.length > 0) { setPairs(r.pairs); setName(f.name); }
    } catch (e) { setErrors([`Could not read ${f.name}: ${e instanceof Error ? e.message : String(e)}`]); }
    if (fileRef.current) fileRef.current.value = "";
  }

  const summary = useMemo(() => datasetSummary(pairs), [pairs]);
  const m = useMemo(() => (rows ? computeMetrics(rows) : null), [rows]);
  const bm = useMemo(() => (base ? computeMetrics(base) : null), [base]);
  const safety = useMemo(() => (rows ? computeSafety(rows) : null), [rows]);
  const cm = useMemo(() => (rows ? confusion(rows) : null), [rows]);

  const shown = useMemo(() => {
    if (!rows || !sel) return [];
    return sel.kind === "cell" ? rows.filter((r) => r.pair.truth === sel.truth && r.predicted === sel.pred) : rows.filter((r) => binCell(r) === sel.cell);
  }, [rows, sel]);
  const selLabel = !sel ? "" : sel.kind === "cell" ? `Ground truth ${word(sel.truth)} → AI ${word(sel.pred)}` : `${BIN_TEXT[sel.cell]} — ${BIN_DESC[sel.cell]}`;
  const ex = explaining ? explainInput(explaining) : null;

  const val = (v: number | null) => (m && !m.sufficient ? NA : pct(v));
  const Stat = ({ label, value, tone, note }: { label: string; value: string; tone?: string; note?: string }) => (
    <div className="stat"><p className="label">{label}</p><p className="value" style={{ color: tone, fontSize: value === NA ? 12 : undefined }}>{value}</p>{note && <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0" }}>{note}</p>}</div>
  );

  return (
    <section aria-labelledby="vl-title">
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <div>
            <p id="vl-title" style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Validation Lab</p>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "2px 0 0" }}>Metrics are computed by running the live matcher on a labelled ground-truth dataset.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setPairs(scenarioPairs); setName(SCENARIO_NAME); setErrors([]); }}>Load prepared dataset</button>
            <button className="primary" onClick={() => fileRef.current?.click()}>Import CSV / Excel</button>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden aria-label="Import ground-truth dataset" onChange={(e) => onImport(e.target.files?.[0])} />
          </div>
        </div>
        <p style={{ fontSize: 12, margin: "8px 0 0" }}>Dataset: <strong>{name}</strong>{name === SCENARIO_NAME && " — labels are illustrative, not an expert-certified benchmark."}</p>
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0" }}>Import format: columns <span className="mono">Material A</span>, <span className="mono">Material B</span>, <span className="mono">Ground Truth</span> (DUPLICATE, FUNCTIONALLY_EQUIVALENT, SIMILAR, NOT_EQUIVALENT).</p>
        {errors.length > 0 && <ul role="alert" style={{ fontSize: 12, color: "var(--danger)", margin: "8px 0 0", paddingLeft: 18 }}>{errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}{errors.length > 6 && <li>…and {errors.length - 6} more</li>}</ul>}
      </div>

      <div className="panel" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 12 }}>
        <Stat label="Total labelled pairs" value={String(summary.total)} />
        <Stat label="Validation records" value={String(summary.total)} note="all pairs are held-out" />
        <Stat label="Training records" value="0" note="rule-based matcher; no training pipeline" />
        <Stat label="Duplicate cases" value={String(summary.duplicate)} />
        <Stat label="Equivalence cases" value={String(summary.equivalent)} note={`+ ${summary.similar} similar`} />
        <Stat label="Negative cases" value={String(summary.negative)} />
      </div>

      <div aria-live="polite" style={{ fontSize: 12, color: "var(--text-secondary)", padding: "8px 16px" }}>{busy ? "Running matcher on labelled pairs…" : m && !m.sufficient ? `${NA}: ${m.insufficiencyReason}` : ""}</div>

      {m && (
        <div className="panel">
          <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>Matching metrics</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px,1fr))", gap: 12 }}>
            <Stat label="Precision" value={val(m.precision)} />
            <Stat label="Recall" value={val(m.recall)} />
            <Stat label="F1 score" value={val(m.f1)} />
            <Stat label="Accuracy" value={val(m.accuracy)} note={`4-class exact: ${val(m.exactClassAccuracy)}`} />
            <Stat label="False positive rate" value={val(m.falsePositiveRate)} />
            <Stat label="False negative rate" value={val(m.falseNegativeRate)} />
            <Stat label="Human review rate" value={val(m.humanReviewRate)} note={`${m.reviewed} of ${m.n} pairs`} />
          </div>
          <div style={{ marginTop: 12, padding: 12, border: "1.5px solid var(--danger)", borderRadius: "var(--radius)", background: "var(--danger-bg)" }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, margin: 0, color: "var(--danger)" }}>FALSE MERGE RATE — SAFETY-CRITICAL</p>
            <p style={{ fontSize: 22, fontWeight: 700, margin: "2px 0", color: "var(--danger)" }}>{m.sufficient ? pct(m.falseMergeRate) : NA}</p>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>{m.falseMerges} of {m.autoMerges} automatic merges (duplicate verdict, no human review) were not true duplicates. Wrongly merging non-equivalent industrial materials is worse than missing a match.</p>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "8px 0 0" }}>“Equivalent” = DUPLICATE or FUNCTIONALLY_EQUIVALENT. SIMILAR counts as not equivalent on both sides, because it requires review before substitution.</p>
        </div>
      )}

      {rows && cm && m && (
        <div className="panel">
          <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>Confusion matrix <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>— click a cell to see the pairs</span></p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <caption style={{ textAlign: "left", fontSize: 11, color: "var(--text-muted)" }}>Rows: ground truth · Columns: AI prediction</caption>
              <thead><tr><th scope="col">Truth ↓ / AI →</th>{TRUTHS.map((p) => <th key={p} scope="col">{word(p)}</th>)}</tr></thead>
              <tbody>{TRUTHS.map((t) => (
                <tr key={t}><th scope="row">{word(t)}</th>{TRUTHS.map((p) => {
                  const n = cm[t][p]; const ok = t === p; const active = sel?.kind === "cell" && sel.truth === t && sel.pred === p;
                  return <td key={p}><button disabled={n === 0} aria-pressed={active} aria-label={`Ground truth ${word(t)}, AI ${word(p)}: ${n} pairs`} onClick={() => setSel({ kind: "cell", truth: t, pred: p })}
                    style={{ minWidth: 44, fontWeight: 600, background: active ? "var(--accent-bg)" : undefined, color: n === 0 ? "var(--text-muted)" : ok ? "var(--success)" : "var(--danger)" }}>{n}</button></td>;
                })}</tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 8, marginTop: 12 }}>
            {(["TP", "TN", "FP", "FN"] as BinCell[]).map((c) => {
              const n = m[c.toLowerCase() as "tp"]; const bad = c === "FP" || c === "FN";
              return <button key={c} disabled={n === 0} aria-pressed={sel?.kind === "bin" && sel.cell === c} onClick={() => setSel({ kind: "bin", cell: c })} style={{ textAlign: "left", padding: 10 }}>
                <span style={{ display: "block", fontSize: 11, color: "var(--text-secondary)" }}>{BIN_TEXT[c]}</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: n > 0 && bad ? "var(--danger)" : "var(--text-primary)" }}>{n}</span>
              </button>;
            })}
          </div>

          {sel && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 12, fontWeight: 600, margin: "0 0 6px" }}>{selLabel} · {shown.length} pair(s) <button onClick={() => setSel(null)} style={{ marginLeft: 8 }}>Clear</button></p>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Material A</th><th>Material B</th><th>AI</th><th>Ground truth</th><th>Route</th><th /></tr></thead>
                  <tbody>{shown.map((r) => (
                    <tr key={r.pair.id}>
                      <td>{r.pair.a}</td><td>{r.pair.b}</td>
                      <td><span className="badge accent">{word(r.predicted)}</span></td>
                      <td><span className={`badge ${r.predicted === r.pair.truth ? "success" : "danger"}`}>{word(r.pair.truth)}</span></td>
                      <td>{r.needsReview ? "Human review" : "Automatic"}</td>
                      <td><button onClick={() => setExplaining(r)}>View AI Explanation</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {safety && (
        <div className="panel">
          <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>Safety Validation</p>
          {!safety.sufficient ? <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>{NA} — needs at least {20} labelled pairs including 5 non-equivalent ones.</p> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12 }}>
              <Stat label="Unsafe merges detected" value={String(safety.unsafeProposals)} note={`AI linked non-equivalent pairs (of ${safety.negatives})`} tone="var(--warning)" />
              <Stat label="Unsafe merges prevented" value={String(safety.heldForReview)} note="stopped by the human-review gate" tone="var(--success)" />
              <Stat label="Unsafe merges that escaped" value={String(safety.autoMerged)} note="merged automatically" tone={safety.autoMerged > 0 ? "var(--danger)" : "var(--success)"} />
              <Stat label="Correctly rejected" value={String(safety.correctlyRejected)} note="non-equivalent, AI agreed" />
              <Stat label="High-risk cases" value={String(safety.highRisk)} note="AI safety risk = HIGH" />
              <Stat label="High-risk → human review" value={String(safety.sentToReview)} />
              <Stat label="High-risk → rejected" value={String(safety.rejected)} />
            </div>
          )}
        </div>
      )}

      {m && bm && times && (
        <div className="panel">
          <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>Baseline vs OneCode AI</p>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 8px" }}>Baseline = plain description-text similarity (threshold 0.8, no attribute rules, no safety logic, no review gate). Measured on the same {m.n} pairs; no claim beyond this dataset.</p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Metric</th><th>Baseline</th><th>OneCode AI</th></tr></thead>
              <tbody>
                {([["Precision", bm.precision, m.precision], ["Recall", bm.recall, m.recall], ["F1", bm.f1, m.f1], ["False merge rate", bm.falseMergeRate, m.falseMergeRate]] as [string, number | null, number | null][]).map(([l, a, b]) => (
                  <tr key={l}><td>{l}</td><td>{m.sufficient ? pct(a) : NA}</td><td>{m.sufficient ? pct(b) : NA}</td></tr>
                ))}
                <tr><td>Processing time (this run)</td><td>{times.base.toFixed(1)} ms</td><td>{times.ai.toFixed(1)} ms</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        Validated institutional knowledge: <strong>{confirmedLinks}</strong> human-confirmed substitution relationship(s) recorded in the audit-backed reference table and knowledge graph.
      </div>

      {ex && explaining && <ExplainDrawer entry={ex.entry} materials={ex.materials} onClose={() => setExplaining(null)} />}
    </section>
  );
}
