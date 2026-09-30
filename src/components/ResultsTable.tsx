import { useState } from "react";
import { useMemo } from "react";
import type { MappingEntry, PipelineResult } from "../lib/types";
import ExplainDrawer from "./ExplainDrawer";

const STATUS_BADGE: Record<string, string> = {
  "auto-issued": "success",
  "pending-review": "warning",
  "reviewed-confirmed": "accent",
  "reviewed-rejected": "danger",
};

export default function ResultsTable({ result }: { result: PipelineResult }) {
  const [filter, setFilter] = useState("");
  const [explaining, setExplaining] = useState<MappingEntry | null>(null);
  const materials = useMemo(() => new Map(result.materials.map((m) => [m.id, m])), [result.materials]);
  const rows = result.mapping
    .filter((r) => !filter || r.nmcCode.toLowerCase().includes(filter.toLowerCase()) || (r.currentNmcCode ?? "").toLowerCase().includes(filter.toLowerCase()) || r.ownCode.toLowerCase().includes(filter.toLowerCase()))
    .slice(0, 100);

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
          Issued codes &amp; mapping ({result.mapping.length} total)
        </p>
        <input type="text" placeholder="Filter by code…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 200 }} />
      </div>
      <table>
        <thead>
          <tr><th>National code</th><th>CPSE</th><th>Own code</th><th>Status</th><th>Validated substitute</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.materialId}>
              <td className="mono">
                {r.nmcCode}
                {r.currentNmcCode && <div style={{ fontSize: 11, color: "var(--warning)" }}>superseded → {r.currentNmcCode}</div>}
              </td>
              <td>{r.cpseId}</td>
              <td className="mono">{r.ownCode}</td>
              <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status.replace("-", " ")}</span></td>
              <td className="mono">{r.linkedNmcCode ?? "—"}</td>
              <td>{r.decision.matchedMaterialId && r.decision.verdict !== "distinct" ? <button onClick={() => setExplaining(r)}>Explain Match</button> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.mapping.length > 100 && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>Showing first 100 of {result.mapping.length} — use the filter to find a specific code.</p>
      )}
      {explaining && <ExplainDrawer entry={explaining} materials={materials} onClose={() => setExplaining(null)} />}
    </div>
  );
}
