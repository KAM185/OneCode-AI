import { useState } from "react";
import type { CpseUpload } from "../lib/pipeline";
import { CPSE_LIST } from "../lib/constants";

interface Props {
  onRun: (uploads: CpseUpload[]) => void;
  running: boolean;
  progress: string;
}

interface StagedFile {
  file: File;
  cpseId: string;
}

export default function UploadPanel({ onRun, running, progress }: Props) {
  const [staged, setStaged] = useState<StagedFile[]>([]);

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    const next: StagedFile[] = Array.from(fileList).map((file, i) => ({
      file,
      cpseId: CPSE_LIST[(staged.length + i) % CPSE_LIST.length],
    }));
    setStaged((s) => [...s, ...next]);
  }

  return (
    <div className="panel">
      <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 10px" }}>Upload material master files</p>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 10px" }}>
        CSV, Excel (.xlsx/.xls), or SAP-style flat exports — with or without a header row. Upload one file per CPSE,
        or a single mixed file covering several CPSEs (an organization/CPSE column is detected automatically; the
        tag below is only the fallback when none is found).
      </p>

      <input type="file" multiple accept=".csv,.xlsx,.xls,.tsv,.txt" onChange={(e) => handleFiles(e.target.files)} />

      {staged.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {staged.map((f, i) => (
            <div key={`${f.file.name}-${i}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "0.5px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
              <span style={{ fontSize: 12 }}>{f.file.name}</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select
                  value={f.cpseId}
                  onChange={(e) => setStaged((s) => s.map((x, idx) => (idx === i ? { ...x, cpseId: e.target.value } : x)))}
                >
                  {CPSE_LIST.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <button onClick={() => setStaged((s) => s.filter((_, idx) => idx !== i))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
        <button
          className="primary"
          disabled={staged.length === 0 || running}
          onClick={() => onRun(staged.map((s) => ({ file: s.file, cpseId: s.cpseId })))}
        >
          {running ? "Running pipeline…" : `Run pipeline on ${staged.length} file(s)`}
        </button>
        {running && <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{progress}</span>}
      </div>
    </div>
  );
}
