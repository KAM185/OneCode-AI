import type { PipelineResult } from "../lib/types";
import { headlineStats } from "../lib/headline";

export default function HeadlineCard({ result }: { result: PipelineResult }) {
  const h = headlineStats(result);
  return (
    <div className="panel headline">
      <div className="headline-main">
        <p className="label">Catalogue harmonisation</p>
        <p className="headline-figure">
          {h.items.toLocaleString()} <span className="arrow">→</span> {h.codes.toLocaleString()}
          <span className="headline-unit"> national codes</span>
        </p>
        <p className="headline-sub">
          {h.reductionPct}% fewer codes across {h.cpses} CPSE{h.cpses === 1 ? "" : "s"} — counted from this run.
        </p>
      </div>
      <div className="headline-side">
        <div className="stat"><p className="label">Auto-resolved</p><p className="value" style={{ color: "var(--success)" }}>{h.autoResolvedPct}%</p></div>
        <div className="stat"><p className="label">Awaiting review</p><p className="value" style={{ color: "var(--warning)" }}>{h.pendingReview.toLocaleString()}</p></div>
        <div className="stat"><p className="label">High safety risk</p><p className="value" style={{ color: h.highRisk > 0 ? "var(--danger)" : undefined }}>{h.highRisk.toLocaleString()}</p></div>
      </div>
    </div>
  );
}
