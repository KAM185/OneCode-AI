import { useMemo } from "react";
import type { PipelineResult } from "../lib/types";
import { computeEconomics } from "../lib/economics";
import { downloadTextFile, economicsCsv } from "../lib/export";

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function EconomicsPanel({ result }: { result: PipelineResult }) {
  const s = useMemo(() => computeEconomics(result.mapping, result.materials), [result.mapping, result.materials]);
  const noData = s.withBoth === 0 && s.withQuantity === 0;

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Economic impact</p>
        <button onClick={() => downloadTextFile(`nmc-economics-${new Date().toISOString().slice(0, 10)}.csv`, economicsCsv(s))}>Download (CSV)</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, marginBottom: 10 }}>
        <div className="stat"><p className="label">Source codes → national codes</p><p className="value">{s.entries} → {s.uniqueCodes}</p></div>
        <div className="stat"><p className="label">Catalogue reduction</p><p className="value" style={{ color: "var(--success)" }}>{s.catalogueReductionPct}%</p></div>
        <div className="stat"><p className="label">Codes shared by 2+ CPSEs</p><p className="value">{s.multiCpseCodes}</p></div>
        <div className="stat"><p className="label">Price-harmonisation opportunity</p><p className="value" style={{ color: "var(--accent)" }}>{fmt(s.harmonizationSavings)}</p></div>
      </div>

      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 8px" }}>
        {noData
          ? "No quantity / unit-price columns were detected in the uploaded files, so only catalogue reduction is shown."
          : `Quantity present on ${s.withQuantity} of ${s.entries} rows, unit price on ${s.withPrice}, both on ${s.withBoth}. Total value (qty × price, rows with both): ${fmt(s.totalValue)}${s.totalValue > 0 ? ` — opportunity is ${s.savingsPctOfValue}% of it` : ""}. Currency and units are as given in the source files.`}
      </p>
      <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 10px" }}>
        Opportunity = Σ quantity × (price paid − lowest price seen for the same national code), for codes with 2+ priced rows and one consistent unit
        of measure. An indicative upper bound if every buyer had matched the best observed price — not a guaranteed saving.
        {s.mixedUomCodes > 0 ? ` ${s.mixedUomCodes} code(s) mix units of measure and are excluded from quantity and price maths.` : ""}
      </p>

      {s.topSavings.length > 0 && (
        <>
          <p style={{ fontSize: 12, fontWeight: 600, margin: "0 0 4px" }}>Largest price-harmonisation opportunities</p>
          <table>
            <thead><tr><th>National code</th><th>CPSEs</th><th>Qty</th><th>Price range</th><th>Opportunity</th></tr></thead>
            <tbody>
              {s.topSavings.map((c) => (
                <tr key={c.nmcCode}>
                  <td className="mono">{c.nmcCode}</td>
                  <td>{c.cpses.join(", ")}</td>
                  <td>{c.totalQuantity !== null ? `${fmt(c.totalQuantity)} ${c.uom}` : "—"}</td>
                  <td>{fmt(c.minPrice ?? 0)} – {fmt(c.maxPrice ?? 0)}</td>
                  <td>{fmt(c.harmonizationSavings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {s.topCombinedDemand.length > 0 && (
        <>
          <p style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 4px" }}>Combined demand across CPSEs (joint-procurement candidates)</p>
          <table>
            <thead><tr><th>National code</th><th>CPSEs</th><th>Combined qty</th></tr></thead>
            <tbody>
              {s.topCombinedDemand.map((c) => (
                <tr key={c.nmcCode}>
                  <td className="mono">{c.nmcCode}</td>
                  <td>{c.cpses.join(", ")}</td>
                  <td>{fmt(c.totalQuantity as number)} {c.uom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
