import { useState } from "react";
import type { NmcRecord, Supersession } from "../lib/types";
import { addSupersession, SupersessionError, type SupersessionMap } from "../lib/registry";
import { appendAuditEntry } from "../lib/audit";
import { getOrCreateIdentity } from "../lib/identity";

interface Props {
  records: NmcRecord[];
  supersessions: SupersessionMap;
  onChange: (next: SupersessionMap) => void;
}

export default function LifecyclePanel({ records, supersessions, onChange }: Props) {
  const [oldCode, setOldCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [reason, setReason] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = new Set(records.map((r) => r.nmcCode));
  const active = records.filter((r) => !supersessions[r.nmcCode]);
  const list: Supersession[] = Object.values(supersessions).sort((a, b) => b.at.localeCompare(a.at));

  async function submit() {
    setError(null);
    if (!reviewer.trim()) { setError("Enter your reviewer id — lifecycle changes are signed."); return; }
    setBusy(true);
    try {
      const input = { oldCode, newCode, reason, by: [reviewer.trim()] };
      addSupersession(supersessions, input, known); // validate BEFORE signing anything
      const id = await getOrCreateIdentity(reviewer.trim());
      const entry = await appendAuditEntry(
        "code_superseded",
        { oldCode: oldCode.trim(), newCode: newCode.trim(), reason: reason.trim() },
        [id]
      );
      onChange(addSupersession(supersessions, { ...input, auditSeq: entry.seq }, known));
      setOldCode(""); setNewCode(""); setReason("");
    } catch (e) {
      setError(e instanceof SupersessionError ? e.message : "Could not record the change — see console.");
      if (!(e instanceof SupersessionError)) console.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>Code lifecycle — supersession</p>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 10px" }}>
        Retire a national code in favour of another (spec change, standard withdrawn, consolidation). The old code is never
        deleted: rows that used it are redirected to the code in force, and the change is signed into the audit log.
      </p>
      <datalist id="nmc-codes">{active.map((r) => <option key={r.nmcCode} value={r.nmcCode}>{r.canonicalDescription}</option>)}</datalist>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <input list="nmc-codes" placeholder="Code being retired" value={oldCode} onChange={(e) => setOldCode(e.target.value)} />
        <input list="nmc-codes" placeholder="Replacement code" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
        <input placeholder="Reason (e.g. DIN 934 withdrawn)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <input placeholder="Your reviewer id" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
      </div>
      {error && <p style={{ fontSize: 12, color: "var(--danger)", margin: "0 0 8px" }}>{error}</p>}
      <button className="primary" disabled={busy || records.length === 0} onClick={submit}>{busy ? "Signing…" : "Supersede code"}</button>

      {list.length > 0 && (
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Retired</th><th>Replaced by</th><th>Reason</th><th>By</th></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.oldCode}>
                <td className="mono">{s.oldCode}</td>
                <td className="mono">{s.newCode}</td>
                <td>{s.reason}</td>
                <td>{s.by.join(", ")}{s.auditSeq !== undefined ? ` · audit #${s.auditSeq}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
