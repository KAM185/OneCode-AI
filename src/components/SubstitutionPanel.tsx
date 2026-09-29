import type { SubstitutionLink } from "../lib/types";

/** Real legacy materials (CPSE · own code) recorded for this NMC code when the link was confirmed. */
function Side({ link, code }: { link: SubstitutionLink; code: string }) {
  const ms = (link.members ?? []).filter((m) => m.nmcCode === code);
  return (
    <div>
      {ms.map((m, i) => <div key={i} style={{ fontSize: 11, color: "var(--text-secondary)" }}>{m.cpseId} · {m.ownCode || "—"} · {m.description}</div>)}
      <span className="mono">↕ {code}</span>
    </div>
  );
}

export default function SubstitutionPanel({ links }: { links: SubstitutionLink[] }) {
  return (
    <div className="panel">
      <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>Validated substitution reference table ({links.length})</p>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 10px" }}>
        Every confirmed equivalence becomes a durable, signed link between two national codes. Codes stay separate — this
        table records which one a planner may substitute for the other, and who validated it.
      </p>
      {links.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>No substitutions validated yet — confirm an equivalence in the review queue.</p>
      ) : (
        <table>
          <thead><tr><th>CPSE A material ↕ NMC A</th><th>CPSE B material ↕ NMC B</th><th>Verdict</th><th>Risk</th><th>Validated by</th></tr></thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.id}>
                <td><Side link={l} code={l.codeA} /></td>
                <td><Side link={l} code={l.codeB} /></td>
                <td>{l.verdict.replace("_", " ")}</td>
                <td>{l.safetyRisk ?? "—"}</td>
                <td>{l.confirmedBy.join(", ")}{l.auditSeq !== undefined ? ` · audit #${l.auditSeq}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
