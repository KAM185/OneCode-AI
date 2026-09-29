import type { PipelineResult } from "../lib/types";

interface Nav { relationships: number; evidencePairs: number; validationPairs: number | null; onOpenGraph: () => void; onOpenEvidence: () => void; onOpenValidation: () => void }

export default function Dashboard({ result, nav }: { result: PipelineResult; nav?: Nav }) {
  const total = result.materials.length;
  const duplicates = result.mapping.filter((m) => m.decision.verdict === "duplicate").length;
  const functionalEquiv = result.mapping.filter((m) => m.decision.verdict === "functionally_equivalent").length;
  const similar = result.mapping.filter((m) => m.decision.verdict === "similar").length;
  const distinct = result.mapping.filter((m) => m.decision.verdict === "distinct").length;
  const pendingReview = result.mapping.filter((m) => m.status === "pending-review").length;
  const autoResolvedPct = total === 0 ? 0 : Math.round(((total - pendingReview) / total) * 100);

  const embedderLabel =
    result.stats.embedderStatus === "ready"
      ? "Local AI model active"
      : result.stats.embedderStatus === "not-needed"
        ? "Local AI not needed — rules decided every pair"
        : "Local AI unavailable — lexical fallback used";

  return (
    <>
      <div className="panel" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12 }}>
        <div className="stat"><p className="label">Total materials</p><p className="value">{total}</p></div>
        <div className="stat"><p className="label">Duplicates</p><p className="value" style={{ color: "var(--success)" }}>{duplicates}</p></div>
        <div className="stat"><p className="label">Functionally equivalent</p><p className="value" style={{ color: "var(--accent)" }}>{functionalEquiv}</p></div>
        <div className="stat"><p className="label">Similar (review)</p><p className="value" style={{ color: "var(--warning)" }}>{similar}</p></div>
        <div className="stat"><p className="label">Distinct</p><p className="value">{distinct}</p></div>
      </div>
      {nav && (
        <div className="panel" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px,1fr))", gap: 12 }}>
          <div className="stat"><p className="label">Material knowledge graph</p><p style={{ fontSize: 13, margin: "4px 0 8px" }}>Explore {nav.relationships.toLocaleString()} material relationship{nav.relationships === 1 ? "" : "s"}</p><button className="primary" onClick={nav.onOpenGraph}>Open Graph</button></div>
          <div className="stat"><p className="label">Explainable AI</p><p style={{ fontSize: 13, margin: "4px 0 8px" }}>{nav.evidencePairs > 0 ? `Understand why ${nav.evidencePairs.toLocaleString()} material pair${nav.evidencePairs === 1 ? " was" : "s were"} matched` : "No matched pairs in this run to explain"}</p>{nav.evidencePairs > 0 && <button className="primary" onClick={nav.onOpenEvidence}>View AI Evidence</button>}</div>
          <div className="stat"><p className="label">Validation lab</p><p style={{ fontSize: 13, margin: "4px 0 8px" }}>Measure matching accuracy and safety{nav.validationPairs !== null ? ` on ${nav.validationPairs} labelled pairs` : ""}</p><button className="primary" onClick={nav.onOpenValidation}>Open Validation Lab</button></div>
        </div>
      )}
      {result.stats.auditError && (
        <div className="panel" style={{ fontSize: 12, color: "var(--danger)" }}>
          Audit log write failed ({result.stats.auditError}) — browser storage may be full. Codes were issued but this run is not in the audit trail.
        </div>
      )}
      <div className="panel" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
        <span>{autoResolvedPct}% auto-resolved without human review</span>
        <span>{result.stats.uncategorized} uncategorized · {result.stats.aiClassified} reclassified by AI</span>
        <span className={result.stats.embedderStatus === "unavailable" ? "badge warning" : "badge success"}>{embedderLabel}</span>
        <span>{result.stats.comparisons} comparisons · {result.stats.embeddingsComputed} descriptions embedded once · {result.stats.embeddingCacheHits} cache hits</span>
        <span>Parse {result.stats.parseMs}ms · Match {result.stats.matchMs}ms</span>
        <span className="mono">Run digest {result.runDigest}</span>
      </div>
    </>
  );
}
