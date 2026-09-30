# Demo sample data — 8 CPSEs

Synthetic material-master extracts for **ONGC, IOCL, SAIL, BHEL, CPCL, BPCL, NTPC, HPCL**
(1,039 rows in total). The materials and prices are generated for demonstration; they are not
real inventory or real CPSE data.

Served by the app from `/sample-data/`. The **Load 8-CPSE demo data** button on the upload panel loads and runs all 8 per-CPSE files with the correct CPSE tags in one click.

To upload by hand instead, pick the 8 per-CPSE files together (CPSE tags are pre-selected from each filename — please verify), **or** upload `ALL_8_CPSE_mixed.csv` alone. It holds the same
rows with a `CPSE` column. Use one or the other, not both.

| File | Rows | Format / what it exercises |
|---|---|---|
| `ONGC_material_master.csv` | 134 | SAP field codes (`MATNR`, `MAKTX`, `MEINS`), 10-digit codes |
| `IOCL_material_master.csv` | 118 | Named headers, UTF-8 BOM, `₹` prices, `EA` / `M` / `L` units |
| `SAIL_material_master.csv` | 133 | **No header row** — columns resolved from content alone |
| `BHEL_material_master.xlsx` | 142 | Excel workbook, different header wording |
| `CPCL_material_master.csv` | 116 | `PC` unit, wording variants |
| `BPCL_material_master.csv` | 136 | Title-case descriptions, `INR` prices |
| `NTPC_material_master.csv` | 133 | Lower-case descriptions, Indian digit grouping (`1,25,000.00`), `M` / `DRUM` units |
| `HPCL_material_master.csv` | 127 | Semicolon-delimited, `Rs.` prices, Indian grouping |
| `ALL_8_CPSE_mixed.csv` | 1,039 | Single mixed file with a CPSE column |

## What is deliberately in the data

- **The same item worded differently across CPSEs** — `HEX NUT M12 SS304 DIN934`,
  `NUT HEXAGON M12 STAINLESS STEEL 304 DIN 934`, `hex nut m12 ss304 din934`, and so on.
- **Grade and standard differences** — SS304 vs SS316 vs MS, DIN 934 vs ISO 4032 — which should
  go to review or be treated as equivalents, not silently merged.
- **Near-miss sizes** — M10 vs M100, class 150 vs 300, 4" vs 6" — which must stay distinct.
- **All 16 dictionary categories** — fasteners, flanges, valves, pipes, fittings, gaskets, motors,
  cables, bearings, plates, sections, gauges, lubricants (plus others).
- **Unit conflicts** — the same material in `NOS` at one CPSE and `KG` / `DRUM` at another, so the
  economics roll-up excludes it rather than summing mixed units.
- **Messy cells** — blank quantities or prices, stray spaces, currency prefixes, near-duplicate
  rows inside a single CPSE.
- **Items the dictionary cannot classify** — safety gear, consumables, `MISC ITEM AS PER DRG 5544`
  — plus a few wordings it cannot fully parse (`4 NB FLANGE ...`), which take the review path.

## Check

Run through the pipeline with the lexical fallback matcher (embedding model unavailable), the
8 files produce 432 national codes from 1,039 rows, about 190 items routed to human review, and
10 flagged as high safety risk. Numbers will differ slightly with the embedding model active.
