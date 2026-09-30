import { useState } from "react";
import type { PipelineResult, SubstitutionLink } from "../lib/types";
import { downloadTextFile, mappingCsv, substitutionsCsv } from "../lib/export";

interface Props {
  result: PipelineResult;
  links: SubstitutionLink[];
}

export default function ExportPanel({ result, links }: Props) {
  const cpses = [...new Set(result.mapping.map((m) => m.cpseId))].sort();
  const [cpse, setCpse] = useState("ALL");
  const [readyOnly, setReadyOnly] = useState(false);
  const pending = result.mapping.filter((m) => m.status === "pending-review").length;
  const stamp = new Date().toISOString().slice(0, 10);

  function downloadMapping() {
    const csv = mappingCsv(result, { cpseId: cpse === "ALL" ? undefined : cpse, includePending: !readyOnly });
    downloadTextFile(`nmc-migration-mapping-${cpse === "ALL" ? "all-cpse" : cpse.toLowerCase().replace(/\s+/g, "-")}-${stamp}.csv`, csv);
  }

  return (
    <div className="panel">
      <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>Migration export</p>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 10px" }}>
        Legacy material code → national code mapping, one row per legacy item, ready to load back into SAP (MATNR / MEINS
        columns). The code in force is used, so retired codes are already redirected.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select value={cpse} onChange={(e) => setCpse(e.target.value)}>
          <option value="ALL">All CPSEs</option>
          {cpses.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} />
          Exclude {pending} item(s) still pending review
        </label>
        <button className="primary" onClick={downloadMapping}>Download mapping (CSV)</button>
        <button disabled={links.length === 0} onClick={() => downloadTextFile(`nmc-substitution-table-${stamp}.csv`, substitutionsCsv(links))}>
          Download substitution table ({links.length})
        </button>
      </div>
    </div>
  );
}
