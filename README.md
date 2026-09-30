# OneCode AI

AI-driven material code standardization across CPSEs — SIH 2026, Problem
Statement 26099 (Ministry of Petroleum & Natural Gas / CPCL).



## What changed in v2.3

Three features added on top of v2.1, integrated into the existing dashboard.
Nothing here invents data: each is a projection of, or a measurement run on,
what the app already computes.

- **Material Knowledge Graph** (`graph.ts`, `KnowledgeGraph.tsx`) — CPSEs,
  source materials, canonical NMC codes, substitutes and superseded codes and
  the relations between them, built only from the pipeline result and the
  substitution / supersession registries.
- **Explainable AI / Match Evidence** (`explain.ts`, `ExplainDrawer.tsx`) —
  per-pair attribute comparison, safety checks and the reason for the outcome
  (auto issue / human review / reject), taken from the real decision rule.
- **Material Intelligence Validation Lab** (`validation.ts`,
  `validationData.ts`, `ValidationLab.tsx`) — upload a labelled pairs file
  (Material A, Material B, Ground Truth); every metric is computed by running
  the real matcher on it. Percentages are withheld below a minimum dataset size.

Run `npm test` for the current suite.

---

## What changed in v2.1

Seven known gaps from the previous review, plus three bugs found while
fixing them. Each has regression tests that fail against the old behaviour
(checked by re-introducing the old code).

| # | Gap | What was done | Where |
|---|-----|---------------|-------|
| 1 | Embeddings re-computed on every comparison | Every distinct description is embedded **at most once** per session (vector cache keyed by normalised text, 100k-entry cap); descriptions likely to be compared are batch-prefetched in chunks of 32; subtype prototypes are embedded once, not once per unrecognised row. All later comparisons are dot products. The dashboard shows "N descriptions embedded once · M cache hits". | `embeddings.ts`, `pipeline.ts` |
| 2 | No migration export | **Download mapping (CSV)** — one row per legacy item with SAP-style columns (`LEGACY_MATNR`, `MEINS`, `NEW_NMC_CODE` …), per-CPSE filter, and an "exclude pending review" switch. Uses the code in force (follows supersession). Also exports the substitution table and economics. Cells from uploaded files are neutralised against spreadsheet formula injection. | `export.ts`, `ExportPanel.tsx` |
| 3 | Confirmed equivalence not persisted | Confirming now sets `linkedNmcCode`, keeps the two codes separate, writes a signed audit entry that includes the link, and stores the pair in a persistent **substitution reference table** (one undirected link per pair, evidence accumulates across CPSEs/reviewers). Rejecting a *merge* now really un-merges the row (it used to flip the status but leave the merged code). | `review.ts`, `registry.ts`, `SubstitutionPanel.tsx` |
| 4 | Quantity/price parsed but unused | New economics roll-up: catalogue reduction, combined demand per code across CPSEs, total value, and a price-harmonisation opportunity (Σ qty × (price − lowest price seen for the same code)) shown with its assumption. Rows with mixed units of measure are excluded rather than summed. No assumed carrying-cost or market-price figures. Also fixed number parsing: `parseFloat("1,25,000")` was returning `1`. | `economics.ts`, `EconomicsPanel.tsx`, `parse.ts` |
| 5 | Cross-CPSE function unverified | See "What is and isn't verified" below. The function was also **fixed**, not just tested: the old read-modify-write array lost updates under concurrency (reproduced: 1 of 12 publishers survived), and the client made one HTTP request per unique code. | `netlify/lib/fingerprint-core.mjs`, `backend.ts`, `scripts/verify-deploy.mjs` |
| 6 | Early exit could settle for a worse match | A material is now compared against every plausible candidate and keeps the strongest (duplicate > equivalent > similar; then confidence; then lower safety risk). The only early exit is a perfect, review-free exact duplicate, which nothing can beat. Complexity stays near-linear: complete items are only compared within the same dimension key (identical results — different dimensions are always distinct) and one representative per code. | `match.ts`, `pipeline.ts` |
| 7 | Supersession was a schema field | Real lifecycle: a signed **Supersede code** action (validated: no self-reference, no cycles, no re-superseding), a persistent registry, `NmcRecord.supersededBy` populated, and `currentNmcCode` on mapping rows so stale codes are redirected in later runs and in the export. `nmcCode` is never rewritten, so what was originally issued stays in the audit trail. | `registry.ts`, `LifecyclePanel.tsx` |

### Additional bugs found and fixed along the way

- **Audit log silently lost entries.** The pipeline fired one un-awaited
  `appendAuditEntry` per row; overlapping calls read the same log tail and
  the last write won. A 50-row burst left **1** entry and the chain still
  "verified". Appends are now serialised, and a run writes one atomic batch
  (also removes thousands of full-log localStorage rewrites). A storage-quota
  failure is now reported on the dashboard instead of being swallowed.
- **Thread sizes were truncated:** `M100` parsed as `M10` and `M150` as `M15`,
  merging different sizes onto one code. Up to three digits are now read, and
  a size is never cut mid-number.
- **Quadratic hot spots** in the pipeline (`mapping.find` inside a loop) and
  the export were replaced with map lookups.

### What is and isn't verified for the cross-CPSE function

Verified here (`tests/fingerprint.test.ts`, 10 tests): the function's real
logic running against a **real `@netlify/blobs` client talking HTTP to
Netlify's own local Blobs server** (the implementation behind `netlify dev`) —
correctness, idempotency, 12 concurrent writers losing nothing, key-collision
edge cases, input validation, store-outage handling, and the
strong-consistency fallback.

**Not** verified: a live Netlify deployment (the runtime wrapper, deployed
Blobs auth/consistency, routing). This sandbox cannot reach Netlify. After you
deploy, run one command:

```bash
npm run verify-deploy -- https://<your-site>.netlify.app
```

It publishes a throw-away code as two fake CPSEs and checks each is told about
the other (6 checks, non-zero exit on failure). I ran that script against a
local server wrapping the real function code and it passes, and correctly
fails against a wrong URL — but that is a check of the script, not of your
deployment.

Also changed: the function no longer sets `config.path` to its own default
`/.netlify/functions/...` URL. Per Netlify's docs a custom path replaces the
default route; the setting was redundant, and removing it leaves the route
the client calls. I could not confirm it was actually breaking anything.

---

## What changed in v2.0


A previous build had five known problems. Here's what was actually done
about each one, and how you can check it yourself.

### 1. Uncategorized items no longer collide (was: real bug)
Every unrecognized or incomplete material used to collapse to the same bare
code (e.g. every "Uncategorized" row became `NMC-UNC-UNK`), which silently
flagged unrelated materials as duplicates of each other.
**Fix:** `code.ts` now appends a content hash of the material's own
description whenever its identity is incomplete — so it only collides with
something that's actually near-identical. See `tests/code.test.ts`, in
particular the two tests marked `REGRESSION`, which fail against the old
logic and pass against the new logic.

### 2. Dictionary expanded from ~5 to 16 material categories
`dictionary.ts` now covers fasteners (nuts, bolts, studs, washers), piping
(flanges, valves, pipes, fittings, gaskets), electrical (motors, cables),
mechanical (bearings), structural (plates, sections), instrumentation
(gauges), and consumables (lubricants) — with real attribute extraction for
each (thread size, pressure class, schedule, power/voltage/poles, cable
cores, bearing numbers, etc.), not just a category label. `tests/dictionary.test.ts`
exercises all 16 with realistic descriptions.

### 3. Real embedding model, with an honest fallback
`embeddings.ts` now loads an actual sentence-embedding model
(all-MiniLM-L6-v2, quantized, ~23MB) via `@huggingface/transformers`,
running entirely client-side in WASM — the same security model as before
(no material data ever leaves the browser). If the model can't load (no
internet, blocked host, air-gapped network), every caller automatically
falls back to a character-trigram + token-Jaccard comparison in `text.ts`,
and this is reported honestly in the dashboard ("Local AI unavailable —
lexical fallback used") rather than silently degrading.
**What I could not verify from this sandbox:** my build environment has no
network access to huggingface.co, so I could not actually confirm the model
downloads and runs correctly in a real browser. The fallback path IS fully
tested (`tests/match.test.ts` mocks the embedder as unavailable and confirms
every decision still resolves correctly). Please test the live model
yourself after deploying — open the browser console and confirm you see no
errors on first upload, and check the dashboard badge reads "Local AI
active" rather than the fallback message.

### 4. Real cryptographic sign-off, not a text box
The previous "type your name to override" box proved nothing. `identity.ts`
now generates a real ECDSA (P-256) keypair per reviewer, non-extractable,
cached in IndexedDB. Every review action in `audit.ts` is signed with that
key; `AuditPanel.tsx` has a **"Verify chain integrity"** button that
recomputes every hash in the log and cryptographically verifies every
signature. Try it: resolve an item in the review queue, then open your
browser's dev tools, manually edit an entry in `localStorage` under
`onecode_audit_log_v2`, reload, and click verify — it will report exactly
which entry was tampered with.

### 5. Automated tests (there were none before)
The v2.0 suite was 48 tests across 6 files; v2.1 is **125 tests across 16 files**. Run with `npm test`. The original six:
- `tests/text.test.ts` — token/trigram similarity, hashing
- `tests/dictionary.test.ts` — attribute extraction across all 16 categories
- `tests/code.test.ts` — NMC code generation, including the collision-fix regressions
- `tests/match.test.ts` — the full decision cascade (embedding model mocked
  out so the tests are deterministic and don't need network access)
- `tests/parse.test.ts` — headerless files, SAP field codes, mixed multi-CPSE files
- `tests/pipeline.test.ts` — end-to-end runs, including the exact ONGC/SAIL
  hex-nut convergence scenario from the pitch, and the grade-downgrade
  safety-review scenario

Two real bugs were caught and fixed by writing these tests (not by manual
review): a standards-equivalence case that was incorrectly auto-merging
instead of routing to review, and a safety-risk case where a grade downgrade
could fall through to "distinct" without triggering review if the wording
happened to score low on text similarity. Both are now covered by
regression tests so they can't silently return.

## Project structure

```
src/lib/
  types.ts         shared data shapes
  text.ts          pure text utilities: tokenizing, Jaccard, trigram cosine, hashing
  dictionary.ts     the shared canonical dictionary — 16 subtypes, attribute extractors
  embeddings.ts      real in-browser embedding model + fallback
  parse.ts          Stage 0 — file ingestion, header detection, scored column resolution
  match.ts           Stages 1-4 — blocking, decision cascade, Substitution Safety Score
  code.ts            Stage 6 — deterministic NMC code generation
  identity.ts        real ECDSA reviewer keypairs (IndexedDB)
  audit.ts           hash-chained, signed, append-only audit log
  pipeline.ts        orchestrates a full run across multiple CPSE files
  backend.ts         batched client for the one serverless function
  storage.ts         localStorage JSON helper with in-memory fallback
  registry.ts        substitution reference table + code-supersession registry
  review.ts          pure review transitions (confirm / reject / un-merge / link)
  economics.ts       quantity & price roll-up (demand, value, price harmonisation)
  export.ts          CSV builders: migration mapping, substitutions, economics
src/components/      UploadPanel, Dashboard, ReviewQueue, ResultsTable, ExportPanel,
                     EconomicsPanel, SubstitutionPanel, LifecyclePanel, AuditPanel,
                     KnowledgeGraph, ExplainDrawer, ValidationLab
netlify/functions/
  fingerprint-index.mjs   binds the core to Netlify Blobs
netlify/lib/
  fingerprint-core.mjs    the function's logic (testable without Netlify)
tests/                125 automated tests (vitest)
scripts/setup-offline.mjs   pre-caches the model for air-gapped deployment
scripts/verify-deploy.mjs   live smoke test for a deployed site
```

## Running locally

```bash
npm install
npm test        # run the automated test suite
npm run dev      # start the dev server
```

For the serverless function too, use the Netlify CLI instead of plain `vite dev`:
```bash
npm install -g netlify-cli
netlify dev
```

## Deploying to Netlify

1. Push this folder to a GitHub repo.
2. In Netlify: **Add new site → Import an existing project**, point it at the repo.
3. Build settings are already in `netlify.toml` (`npm run build`, publish
   `dist`, functions `netlify/functions`) — no manual config needed.
4. Deploy. Netlify Blobs (used by the fingerprint-index function) works
   automatically, no extra setup.

## What kinds of files it handles

A synthetic 8-CPSE demo set (1,039 rows, mixed formats) ships in
`public/sample-data/` (served at `/sample-data/`) — see its README. The parser handles real-world
messiness directly:
- **Individual or mixed CPSE files** — a mixed file with an
  organization/CPSE column is detected automatically; per-row CPSE
  overrides the upload tag.
- **Named headers** — common SAP field codes (`MATNR`, `MAKTX`, `MEINS`)
  and everyday names ("Material Description", "Code", "Unit").
- **Unrecognized or missing headers** — every column is also scored by
  content (does it look like a description, a code, a UOM, an org name?).
- **No header row at all** — row 1's shape is compared against row 2's; if
  identical, row 1 is treated as data, and columns resolve by content alone.

## Air-gapped deployment
Run `npm run setup-offline` once on any internet-connected machine to
pre-cache the embedding model, then serve the resulting `public/models/`
folder alongside the built app and point `embeddings.ts` at it (see comments
in `scripts/setup-offline.mjs`). Everything else in the pipeline already has
zero external dependencies once built.

## Honest limitations of this build
- The dictionary's 16 categories cover common CPSE material types with
  real depth, but any specific CPSE's material master will still contain
  items outside this list — those fall to the AI zero-shot classifier
  first, then "Uncategorized" if even that doesn't match. Extending
  coverage is a data-entry task in `dictionary.ts`, not an architecture change.
- The dual-signature override mechanism is real cryptography, appropriate
  for a hackathon deployment — it is not a claim of government-grade PKI or
  identity verification (a production system would tie identities to each
  CPSE's actual SSO/certificate infrastructure).
- The audit log, substitution table and supersession registry persist in
  `localStorage`/IndexedDB, scoped to one browser. A production deployment
  would persist these centrally per CPSE. Audit appends are serialised within
  a tab; two tabs writing at once can still race (localStorage has no
  cross-tab lock).
- Economic figures are arithmetic on the uploaded columns only. The
  price-harmonisation number is an indicative upper bound (everyone matching
  the lowest price seen), not a forecast, and assumes the same code means the
  same item at comparable terms (delivery, quantity breaks, date).
- Embeddings are cached in memory for the session, not across reloads
  (persisting vectors in IndexedDB would make repeat runs near-instant).
- Incomplete/unrecognised items are still compared against everything in
  their category block (they have no structured attributes to rule anything
  out), so a very large all-unrecognised block is the slowest case.
- The fingerprint endpoint is unauthenticated (input-validated and
  size-limited, but anyone who can reach the site can publish codes). Put it
  behind SSO or a shared secret before production use.
- I was not able to test the live embedding model download in this
  sandbox (no network route to huggingface.co here) — please verify it
  after your own deployment, as noted in point 3 above.
