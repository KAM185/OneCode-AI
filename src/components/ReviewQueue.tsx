import { useState } from "react";
import type { MappingEntry, ParsedMaterial } from "../lib/types";
import ExplainDrawer from "./ExplainDrawer";
import { appendAuditEntry } from "../lib/audit";
import { getOrCreateIdentity } from "../lib/identity";
import { linkTargetFor } from "../lib/review";

interface Props {
  entries: MappingEntry[];
  materials: Map<string, ParsedMaterial>;
  onResolve: (entry: MappingEntry, outcome: "confirmed" | "rejected", reviewers: string[], auditSeq: number) => void;
}

const VERDICT_LABEL: Record<string, string> = {
  functionally_equivalent: "Functionally equivalent",
  similar: "Similar — needs judgment",
  duplicate: "Duplicate",
  distinct: "Distinct",
};

export default function ReviewQueue({ entries, materials, onResolve }: Props) {
  const [explaining, setExplaining] = useState<MappingEntry | null>(null);
  const [reviewer, setReviewer] = useState("");
  const [coSigner, setCoSigner] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="panel">
        <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>Review queue</p>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Nothing pending review.</p>
      </div>
    );
  }

  async function resolve(entry: MappingEntry, outcome: "confirmed" | "rejected") {
    setError(null);
    if (!reviewer.trim()) { setError("Enter your reviewer id before taking an action."); return; }
    const isHighRisk = entry.decision.safetyRisk === "HIGH";
    const key = entry.materialId;
    const secondId = coSigner[key]?.trim();

    if (isHighRisk && outcome === "confirmed") {
      if (!secondId) { setError("High-risk substitution: a second reviewer id is required to confirm."); return; }
      if (secondId.toLowerCase() === reviewer.trim().toLowerCase()) { setError("The second sign-off must be a different reviewer."); return; }
    }

    setBusy(key);
    try {
      // Real ECDSA keys, generated/cached per browser profile — not a text
      // field. See identity.ts. Each signer independently signs the exact
      // audit payload, so a forged or reattributed override is
      // cryptographically detectable by verifyAuditChain().
      const primary = await getOrCreateIdentity(reviewer.trim());
      const signers = [primary];
      if (isHighRisk && outcome === "confirmed" && secondId) {
        signers.push(await getOrCreateIdentity(secondId));
      }

      const linkedNmcCode = outcome === "confirmed" ? linkTargetFor(entry) : null;
      const logged = await appendAuditEntry(
        outcome === "confirmed" ? "review_confirmed" : "review_rejected",
        {
          materialId: entry.materialId,
          nmcCode: entry.nmcCode,
          cpseId: entry.cpseId,
          verdict: entry.decision.verdict,
          safetyRisk: entry.decision.safetyRisk,
          dualSigned: isHighRisk && outcome === "confirmed",
          // What this decision actually changed — signed alongside it.
          linkedNmcCode,
          mergeReverted: outcome === "rejected" && entry.decision.verdict === "duplicate",
        },
        signers
      );
      onResolve(entry, outcome, signers.map((s) => s.reviewerId), logged.seq);
    } catch (e) {
      console.error(e);
      setError("Could not record this review (audit log write failed) — nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel">
      <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>Review queue ({entries.length})</p>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 10px" }}>
        Codes are already issued — review corrects the record. Every action is signed with a real key (generated on
        this device, never leaves it) and appended to the audit log; the original AI decision is never overwritten.
      </p>

      <input type="text" placeholder="Your reviewer id" value={reviewer} onChange={(e) => setReviewer(e.target.value)} style={{ marginBottom: 8, width: 260 }} />
      {error && <p style={{ fontSize: 12, color: "var(--danger)", margin: "0 0 10px" }}>{error}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {entries.map((entry) => {
          const isHighRisk = entry.decision.safetyRisk === "HIGH";
          const badgeClass = isHighRisk ? "danger" : entry.decision.verdict === "functionally_equivalent" ? "accent" : "warning";
          return (
            <div key={entry.materialId} style={{ border: "0.5px solid var(--border)", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <p style={{ fontSize: 13, margin: 0 }} className="mono">{entry.nmcCode}</p>
                  <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "4px 0 0" }}>
                    {entry.cpseId} · own code {entry.ownCode} · "{entry.description}"
                  </p>
                  {entry.decision.matchedNmcCode && (
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }} className="mono">
                      vs {entry.decision.matchedNmcCode}
                    </p>
                  )}
                </div>
                <span className={`badge ${badgeClass}`}>{isHighRisk ? "High risk" : VERDICT_LABEL[entry.decision.verdict]}</span>
              </div>

              <ul style={{ fontSize: 12, color: "var(--text-secondary)", margin: "8px 0", paddingLeft: 18 }}>
                {entry.decision.reasons.map((r, i) => <li key={i}>{r}</li>)}
                <li>Confidence {(entry.decision.confidence * 100).toFixed(0)}% · via {entry.decision.stage}</li>
              </ul>

              {isHighRisk && (
                <input
                  type="text"
                  placeholder="Second reviewer id (required to confirm)"
                  value={coSigner[entry.materialId] ?? ""}
                  onChange={(e) => setCoSigner((c) => ({ ...c, [entry.materialId]: e.target.value }))}
                  style={{ width: "100%", marginBottom: 8 }}
                />
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button className="primary" disabled={busy === entry.materialId} onClick={() => resolve(entry, "confirmed")}>
                  {entry.decision.verdict === "duplicate" ? "Confirm merge" : "Confirm equivalence"}
                </button>
                <button disabled={busy === entry.materialId} onClick={() => resolve(entry, "rejected")}>Reject / keep separate</button>
                <button onClick={() => setExplaining(entry)}>Explain Match</button>
              </div>
            </div>
          );
        })}
      </div>
      {explaining && <ExplainDrawer entry={explaining} materials={materials} onClose={() => setExplaining(null)} />}
    </div>
  );
}
