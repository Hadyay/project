# Real Estate ERP — نظام إدارة العقارات

Arabic/RTL ERP replacing a legacy FoxPro-era system. Buildings and units, clients,
sale + rental contracts, and a **full double-entry general ledger** with
multi-currency support.

Stack: **FastAPI + PostgreSQL + Next.js**.

---

## Current state (2026-09-28)

| Area | Status |
| --- | --- |
| `realestate_erp_schema.sql` | Reference DDL — the source of truth for the data model |
| `backend/app/models/` | ✅ Complete — all 14 tables |
| `backend/app/schemas/` | ✅ Complete — Pydantic v2 |
| `backend/app/services/` | ✅ Complete — GL posting, schedules, FX, allocation, audit |
| `backend/app/api/` | ✅ Complete — 86 routes |
| `backend/app/jobs/` | ✅ `nightly` — batch rent invoicing + overdue status |
| `backend/alembic/` | ✅ `0001`…`0009` applied (`initial_schema`, `fix_trial_balance_view`, `org_settings`, `org_logo`, `client_property`, `voucher_ref_no`, `dynamic_roles`, `payment_reminders`, `user_preferences`); `alembic check` is clean |
| `backend/app/seed/` | ✅ Currencies, chart of accounts, admin user |
| `backend/tests/` | ✅ 71 tests, all passing (plain `pytest`, no env overrides needed) |
| `frontend/` | ✅ Next.js 15 + TS — 16 screens, Arabic / English, typechecks and builds clean |
| `legacy_data/` (47 CSVs) | ✅ GL imported and reconciled by `app/seed/legacy_import.py` — into `realestate_erp_full`, see below. Property data is not in the export |

`erp-ui-design.html` is the approved UI design: 14 Arabic/RTL screens. Its
stylesheet was ported **verbatim** into `frontend/src/app/globals.css`, and the
React components emit the same class names — so the design file stays the visual
source of truth. Change the design, re-port the CSS; do not drift the class
names apart.

---

## Running it

Postgres runs in Docker. **Host port 5432 is taken by a native
`postgresql-x64-15` Windows service**, so the container publishes **5433**.
Do not "fix" this by moving it back to 5432 — it will silently connect to the
wrong server and fail authentication.

```bash
docker compose up -d db          # Postgres 16 on localhost:5433

cd backend
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt

# realestate_erp_full holds the imported legacy ledger; realestate_erp is the
# older demo database (see "Which database" below)
export DATABASE_URL="postgresql+psycopg://erp:erp_dev_password@localhost:5433/realestate_erp_full"
./.venv/Scripts/python.exe -m alembic upgrade head
./.venv/Scripts/python.exe -m app.seed.run          # admin / admin123
./.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

Docs at http://localhost:8000/docs. `docker compose up backend` runs the whole
stack instead (inside the network the DB is `db:5432`).

On Windows `--reload` sometimes logs "WatchFiles detected changes… Reloading"
and never finishes: the old worker keeps serving the old code. If a backend
change seems ignored (an old 422 limit, a missing field), restart the server
before debugging.

### Which database

Two exist on the container, and the difference matters:

| Database | Holds |
| --- | --- |
| `realestate_erp_full` | **the real thing** — the imported legacy ledger, 593 accounts, 189 clients, 2,229 entries, trial balance $20,142,142.00 both sides |
| `realestate_erp` | the old demo set, plus a partial legacy import that must not be trusted — five demo client sub-accounts (`41100001`–`41100005`, minted under `4110`) collided with legacy customer codes and were merged. `legacy_import` now refuses that; the database was written before the guard existed. Rebuild it or drop it |

A dump of the demo database as it was before that import is not in the repo —
`python -m app.seed.demo` rebuilds the demo set from scratch against an empty
database.

The special account codes in the root `.env` point at the **legacy** chart now
(`RECEIVABLE_PARENT_CODE=411`, `SALES_REVENUE_CODE=7010002`,
`DEFAULT_CASH_CODE=5300002`). That is not cosmetic: creating a client against
the starter `4110` mints `41100001`, which the imported customers already own,
and the insert fails on the unique index. `RENT_REVENUE_CODE` stays on the
starter `5120` — the Lebanese plan has no rental-income leaf, and picking one
is the client accountant's call.

### Moving to another PC (native PostgreSQL, no Docker)

**The data is not in the project folder.** It lives in Postgres — here, inside
the Docker volume — so a plain folder copy moves no ledger, users or letterhead.
`README-INSTALL.txt` is the one-page guide that travels with the package.

- `package.bat` (this PC) — fresh `pg_dump` into `db_backup\`, then
  `dist\RealEstateERP-<date>.zip` (~0.4 MB) without `.venv`, `node_modules`,
  `.next`, `.env` files, `legacy_data`, `.claude`. Holds the real ledger and
  password hashes: `dist/` and `db_backup/` are gitignored; hand it over privately.
- `setup.bat` (other PC, once) — checks Python 3.11–3.13 / Node ≥ 18.18 /
  PostgreSQL ≥ 14 and offers `winget` installs for what is missing (PostgreSQL
  via the EDB installer, unattended, with a password the user types); starts a
  stopped `postgresql*` service; creates role `erp` + a UTF-8 database;
  restores the dump **as `erp`**; writes `backend\.env` (fresh `JWT_SECRET`,
  CORS for 3000 and 3100, `BACKEND_PORT`/`FRONTEND_PORT`) and
  `frontend\.env.local`; venv + pip; `alembic upgrade head`; probes the DB
  through the app's own engine; `npm ci` (falls back to `npm install`);
  **`next build`**; desktop shortcut. Transcript in `logs\setup-*.log`.
  Options: `-PgPort`, `-PgSuperUser`, `-DbPassword`, `-SkipInstall`,
  `-NoShortcut`, `-Force` (drop and restore), `-Empty`.
- `start.bat` — serves the **production build** (`next start`, uvicorn without
  `--reload`), both bound to 127.0.0.1, in two minimized windows titled
  "ERP backend" / "ERP frontend" (`cmd /k`, so a crash stays readable). Checks
  the DB first, recognises an already-running copy by its page, falls back to
  port 3100 when 3000 is taken, waits for both health checks, opens the browser.
  Visible windows rather than a Windows service, by choice: the client wanted
  it running for a demo first; a service can come later.
- `stop.bat` — kills the recorded PIDs' trees, plus any uvicorn `app.main:app`
  or Next server still on the configured ports.

**It never installs an empty ledger by accident.** A missing backup stops setup
*before* anything is created or dropped (an earlier draft of `-Force` without a
backup dropped the data first); only `-Empty` builds a blank database.

Windows details that each broke a run: PowerShell 5.1 turns a redirected
native stderr into a terminating error under `Stop` (hence `Invoke-Quiet`);
scripts stay ASCII because 5.1 reads BOM-less UTF-8 as ANSI; `PYTHONUTF8=1`
so Arabic output cannot crash Python on a cp1252 console; the restore file is
written under `%ProgramData%` so psql never has to open a path containing the
(possibly Arabic) user name — a precaution, not a reproduced failure; `\restrict` lines from pg_dump ≥ 16.10 / 17.6 are
stripped for older psql; a venv's `python.exe` is a launcher whose child is the
real listener; `timeout` fails without an interactive console (`ping` doesn't).

Tested end to end on a simulated client (clean unzip into a path with a space,
empty PostgreSQL 15, fresh venv and `npm ci`): setup 146 s, start 7 s, same
dashboard figures as here ($4,600,680 receivable, 189 clients); plus port-3000
fallback, double start, stop, database down, and `-Force` with no backup.
Not exercised: the `winget` installs themselves.

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local     # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                          # http://localhost:3000
```

`npm run typecheck` and `npm run build` must both stay clean.

**Never run `npm run build` while `npm run dev` is running.** Both write
`frontend/.next`; the build rewrites it under the live dev server, which then
answers 500 on every page (`Cannot find module …/.next/server/middleware-manifest.json`)
until it is restarted on a clean `.next`. This has broken the running app twice —
once when a second Claude session built into the directory another session was
serving. Stop the dev server first, or build into a separate `distDir`.

**CORS is an allowlist, and the frontend port is part of it.** `BACKEND_CORS_ORIGINS`
(root `.env`) currently allows `localhost:3000` and `localhost:3100`; 3100 is
there because another local app was already holding 3000 on this machine. A
frontend served from any other port gets its API calls blocked by the browser
with no useful error — add the origin rather than debugging the fetch.

### Tests

```bash
docker exec project-db-1 psql -U erp -d postgres -c "CREATE DATABASE realestate_erp_test OWNER erp"

cd backend
TEST_DATABASE_URL="postgresql+psycopg://erp:erp_dev_password@localhost:5433/realestate_erp_test" \
  ./.venv/Scripts/python.exe -m pytest
```

Integration tests need real Postgres — the schema uses native enums, JSONB and
partial indexes, so SQLite cannot stand in. They skip cleanly when no test DB is
reachable. `conftest.py` pins the special account codes to the starter chart
before importing the app: the tests seed that chart, while `backend/.env`
points at the legacy one (`411`…), and without the pin client creation fails
in four tests. The `db` fixture rebuilds the schema per test and calls
`engine.dispose()` afterwards; without that, pooled connections keep OIDs of the
dropped enum types and fail with `cache lookup failed for type ...`.

---

## How the accounting works

This is the part to be careful with. Getting it wrong corrupts the ledger
silently.

**Base currency is USD.** Every amount is stored twice: in its transaction
currency (`debit`/`credit`) and converted to base (`debit_base`/`credit_base`).
Reports only ever read the `_base` columns.

**Every client owns one receivable sub-account** under `4110`, auto-created on
`POST /api/clients` — this mirrors the legacy `ACCOUNTMAP` model, and the client
statement is simply the ledger of that account.

The postings:

| Event | Entry |
| --- | --- |
| Activate a sale contract | Dr client receivable / Cr `5110` sales revenue, for the full price |
| Invoice a rent period | Dr client receivable / Cr `5120` rent revenue, per period |
| Receipt (قبض) | Dr cash/bank / Cr client receivable |
| Payment (صرف) | Dr beneficiary / Cr cash/bank |

Rent revenue is recognised **per period**, not at contract signing — that is why
rent contracts post nothing on activation.

### Rent invoicing and overdue status

Periods can be invoiced one at a time (`POST /api/contracts/{id}/schedule/{row}/invoice`)
or all at once: `POST /api/contracts/rent/invoice-due?as_of=` invoices every due
period on **active** rent contracts that has no live invoice yet. Both go through
`contracts.already_invoiced()`, so a re-run skips rather than doubling the
receivable. Each period posts in its own savepoint; a contract that cannot be
invoiced (no receivable account, no FX rate) is reported in `failures` and the
rest of the run still commits.

`POST /api/contracts/schedule/refresh-overdue?as_of=` writes the `overdue`
status that reads used to only compute: `pending` rows past due on active
contracts become `overdue`, and `overdue` rows that are no longer late go back to
`pending`. **`partial` is left alone** — it records that money arrived; lateness
is still computed on read. Payments move an overdue row to partial/paid through
`allocate_payment`; voiding a receipt drops it to pending until the next refresh.

Both are buttons on جدول الدفعات (accountant) and together form
`python -m app.jobs.nightly [--as-of YYYY-MM-DD] [--dry-run]` — run it from
Task Scheduler with the same `DATABASE_URL` and special account codes as the API.
It exits non-zero if any period failed to invoice.

Things that are enforced, not merely hoped for:

- **Entries must balance.** Checked in the Pydantic schema, again in
  `post_entry`, and finally by a deferred constraint trigger in the DB.
- **Per-line rounding must not unbalance the entry.** `_base_amounts()` in
  `services/ledger.py` converts each line, then absorbs any residual cent into
  the largest line on the heavier side. Removing this reintroduces intermittent
  trigger failures on non-1.0 exchange rates.
- **A missing exchange rate is a 400, never a guess.** `fx.rate_for()` refuses to
  invent one.
- **Header accounts reject postings** (`is_postable = false`).
- **Receipts allocate oldest-due-first** across the schedule; overpayment stays
  on the client's account as a credit rather than being pushed onto a future
  installment. Voiding a receipt reverses the allocation newest-first and
  soft-deletes its GL entry.
- **A soft-deleted entry must leave the totals.** Filtering it on an *outer*
  join does not drop the line — it only nulls the entry columns — so the
  amounts keep counting. `v_trial_balance` and `accounts/trial-balance` both
  had that shape and both were wrong by the value of every voided document;
  debit and credit fell out together, so the sheet still balanced. Both now
  settle which lines count inside a subquery with an inner join, and join back
  to accounts outer so an account that never moved is still listed at zero.
  Migration `0002` carries the view fix, and a test in `test_api_flow.py`
  pins both halves: a voided entry leaves the totals, and a period narrows them.

Deletes are **soft** everywhere (`is_deleted`), and mutations are mirrored into
`audit_log` via `services/audit.py`.

Special account codes are configured in `app/config.py`
(`receivable_parent_code`, `sales_revenue_code`, `rent_revenue_code`,
`default_cash_code`) and looked up by code — never hard-code account IDs.

---

## Legacy import

```bash
cd backend
./.venv/Scripts/python.exe -m app.seed.legacy_import            # dry run
./.venv/Scripts/python.exe -m app.seed.legacy_import --commit   # write
```

The dry run opens no database: it parses, validates and reconciles the planned
trial balance against the legacy `MIZAN.csv`, and exits non-zero if anything
does not add up. Currently clean — **$20,142,142.00 on both sides**, 2,229
entries / 4,463 lines / 189 clients / 2,041 receipts, 2015-10 to 2025-12. The
one expected difference is account `4427001` (VAT collected, $25,072.07 credit):
`SACCOUNT` posts to it, `MIZAN` omits it entirely. That is recorded in
`legacy_map.KNOWN_MIZAN_GAPS`, not hidden.

**The legacy chart is the Lebanese general plan and it does not mean the same
thing as the starter chart.** There, class 5 is cash and banks and class 7 is
revenue; in `chart_of_accounts.py`, 5 is revenue and 6 expenses. The codes
happen not to collide, so the import loads the legacy codes verbatim and hangs
its three-digit roots at top level rather than grafting them onto the starter
chart's `1`…`6`. Until `app/config.py`'s special codes are repointed
(`RECEIVABLE_PARENT_CODE=411`, `SALES_REVENUE_CODE=7010002`,
`DEFAULT_CASH_CODE=5300002` in the root `.env`), new business posts to the
starter chart and imported history sits on the legacy one — two receivable
trees in one ledger. `--commit` prints that reminder.

Judgement calls worth knowing: five entries have lines booked in both LBP and
USD, and `journal_entries` carries one currency, so they are recorded in USD
(the legacy USD columns are authoritative anyway) with the original figure kept
on the line description. 149 `JOURNAL` rows have no lines and one zero-value
receipt has no client — voided documents, skipped. Two accounts posted to but
absent from `ACCOUNTMAP` are synthesized under their parent and flagged for a
proper name.

Re-running is safe: rows are keyed `LEG-`, `LEG-R-`, `LEG-P-` and skipped if
already present. `write(plan, db)` does not commit, so a failure leaves nothing
behind. It also refuses to run when an account code already exists somewhere
else in the chart — a same code under a different parent is a different
account, and merging two people's ledgers silently is the one failure mode
this import must never have.

### What the import carries beyond the ledger

Two more things the office's paper relies on, each filled by its own module
(run by `legacy_import --commit` in the same transaction, and runnable alone
against an existing database: dry run by default, `--commit` to write; both
only fill empty fields, so a value typed in the app since wins):

- **`app.seed.legacy_client_details`** — phone, phone 2, and where the client
  bought: `project` (المشروع والعقار, "الهدفة 432"), `block` ("بلوك B3"),
  `floor_side` (طابق / جهة, "اول غربي"), migration `0005`. ACCOUNTMAP's
  header is mush past the leading columns, but every client row splits into
  exactly 57 fields; the columns (22, 27, 28, 30, and the second half of 45)
  were identified against the office's printed balances report, and the module
  asserts the intact header names and the row width before reading. The row
  alignment was checked independently: all 189 rows' own debit total equals the
  imported ledger's for that client, to the cent — do not "fix" a mismatch you
  think you see on a photo of the paper (a skewed photo misreads by a row).
  Free text on the client, **not** a unit register (see "Next steps").
- **`app.seed.legacy_voucher_numbers`** — `ref_no` on receipts and payments
  (migration `0006`): the number printed on the paper voucher, legacy `MYFNO`
  (992), as opposed to the record id `FNO` (5103) the documents are keyed by
  (`LEG-R-5103`). Statements, the voucher reprint, the lists and search show /
  match `ref_no`; `receipt_no` stays the key because `MYFNO` repeats (17
  duplicates — the old numbering restarted). New receipts may carry one too.
  `RECEIPT.FIDATE` is the legacy ترحيل (posting) date; not imported yet.

## Conventions

- Models are the source of truth for migrations; `alembic check` must stay clean.
  IDs are `BigInteger` + `Identity` (`bigserial`), currency FKs are `SmallInteger`.
- Views and triggers live in migration `0001` as raw SQL. **Autogenerate cannot
  see them** — if you ever regenerate the initial migration, carry them across by
  hand or they will be dropped.
- Money is `Decimal` end to end. Never `float`.
- Arabic is the primary display language: `name_ar` is required, `name_en`
  optional. Keep user-facing strings in the API (entry descriptions) in Arabic.
- Access is gated with `require_perm("module.action", …)` from `app/core/deps.py`
  on every endpoint — see "Access rights". Never gate on a role's name.
- `bcrypt` is pinned to `4.0.1` — passlib 1.7.4 reads `bcrypt.__about__`, which
  4.1+ removed.
- **Never `model_validate` an ORM `Account` straight into `AccountTreeNode`.**
  `Account.parent` has `backref="children"`, so from-attributes validation pulls
  each subtree in (a lazy query per account) and the tree builder then appends
  every node again — one extra copy per level. That is how 594 accounts became
  1,035 rows with React duplicate-key errors. `account_tree` validates through
  `AccountOut` (no `children` field); a test pins every id appearing once.
- The client list carries `balance_base` (`ClientListItem`), summed inside a
  subquery with an inner join on live entries — the same shape as the trial
  balance fix, for the same reason. On `realestate_erp_full` the balances sum
  to the dashboard receivable exactly ($4,600,680.00).

---

## Frontend notes

- **Client-rendered throughout.** The JWT lives in `localStorage` and every screen
  is a client component behind `<Shell>`'s auth guard, so the server-rendered
  HTML is just a loading state. That is expected, not a bug.
- `src/lib/types.ts` mirrors `backend/app/schemas` by hand — **update both together**.
  Money crosses the wire as a JSON string (Decimal) and is never parsed into a
  float for storage or comparison, only for display.
- `useApi()` drops superseded responses, so a slow filter cannot overwrite a
  newer one's results.
- Permission checks in the UI (`can("receipts.create")`) mirror the backend but do
  not replace it — the API is still the enforcement point.
- Numerals render Western/LTR inside RTL text: an accountant reads figures the
  same way in any language, and `tabular-nums` needs a stable glyph width.
- React 19 removed the global `JSX` namespace — use `ReactElement`.

### The redesign of 2026-09-27

The client asked for "simpler, clearer, professional tables, a clear font, a
menu that hides, Arabic and English, a dashboard with everything important,
and reports like our old printouts". Where each piece lives:

- **`app/theme.css`** — the look, loaded *after* globals.css. globals.css stays
  the verbatim port of the mockup; theme.css redefines its tokens (navy/blue
  instead of ink/brass) and restyles its classes, so class names are
  unchanged. Everything in it is direction-neutral (start/end, inset-inline,
  border-inline) because the same rules serve RTL and LTR; the few physical
  rules globals.css has are mirrored under `[dir="ltr"]`. Tables are ruled
  grids with a header band and zebra rows. Only figures, codes and dates
  (`.mono`, `.doc`, `.amt`, `td.nw`) are no-wrap: a table must fit the page,
  or it overflows sideways and the page-pinned header (which needs no
  scrolling ancestor) is lost. `td.mono{display:table-cell}` exists because
  `.mono` is inline-block, and an inline-block `<td>` leaves the table layout
  and shifts every column after it — put `mono` on a span inside the cell.
- **Fonts** — Cairo (text, Arabic + Latin) and Roboto (figures, tabular) via
  `next/font/google` in `app/layout.tsx`: downloaded at build time and served
  by the app, so an offline office PC still renders them. (Before, they came
  from the Google Fonts CDN at runtime.)
- **Menu** — the ☰ in the topbar hides / shows the sidebar on a desktop
  (`.app.nav-hidden`, remembered in `localStorage` `erp.navHidden`); on a phone
  it slides it in as before.
- **Arabic / English** (`lib/i18n.tsx`, `lib/i18n-en.ts`, the EN / ع button) —
  a translation *layer*, not t() calls: with English on, a MutationObserver
  rewrites, in place, every text node and placeholder / title / aria-label
  whose whole text is a dictionary key, and restores the Arabic when switched
  back; `<html dir>` flips to ltr. In-place `nodeValue` writes are safe with
  React (it is adding/removing/wrapping nodes that breaks React under browser
  translators). Exact matches only, plus `${…}` template keys that match as
  patterns — so data (names, descriptions, amounts in words) passes through;
  mark data subtrees `translate="no"` anyway where a value could coincide
  with a label. **Adding a screen string means adding a key** — list every
  Arabic string in `src/` with the extractor used on 2026-09-27 (string
  literals + JSX text containing U+0600–U+06FF) and diff against the
  dictionary. Sentences split around `{values}` in JSX become separate text
  nodes and cannot translate as a whole — write them as one template string.
- **Dashboard** (`app/(app)/page.tsx`, `GET /api/reports/dashboard`) — quick
  actions; four figures that each link to the screen explaining them
  (receivables → كشف الأرصدة, cash → حركة الصندوق, collections, overdue); a
  12-month collections chart in plain CSS (no chart library); tills and banks
  with balances; the largest debtors with their project; latest receipts
  (printed number, reprint button) and entries. The endpoint gained
  `cash_accounts`, `top_debtors`, `recent_receipts`, `debtors_count`,
  `creditors_count`, all over live entries only.
- **Report sheets** (`components/ReportSheet.tsx`, `.rs-*` in print.css) — the
  layout of the office's legacy printouts: firm name, rounded grey header
  boxes, a fully ruled black table, rounded total boxes; identical on screen
  and paper. Used by **كشف حساب** (`Statement.tsx`: client card with project /
  block / floor, period box, balance brought forward, تاريخ السند · نوع ·
  اليومية · رقم السند · الشرح · مدين · دائن · الرصيد, totals) and **كشف الأرصدة
  حسب عملة الحساب** (التقارير → first card, `GET /api/reports/client-balances`:
  code, name, currency, debit, credit, balance, phone, project, block, floor;
  count and total). On paper the letterhead band and screen head are hidden
  where a sheet prints its own (`body:has(.rs)`), and the grey fills are kept
  (`print-color-adjust: exact` on the sheet only — everything else prints
  black and white). `/reports?r=balances|cash|…` opens a given report.
- **Page footer on every printout** — `lib/export.ts` writes the `@page` rule
  with margin boxes: "Page N / M" and the print time
  ("17/09/2026 12:06:18 PM", as the legacy reports stamp it), refreshed on
  `beforeprint` so Ctrl+P gets it too. Margin boxes need Chrome/Edge 131+ (this
  PC: Edge 154); older browsers print without the footer.

### Browsing, printing and exporting

These pieces carry these across every screen, and new screens should use them
rather than rolling their own:

- `components/SearchPanel.tsx` — **the Odoo-style search box** that replaced the
  row of fixed filter fields (2026-09-26, at the client's request: "like Odoo,
  not static fields above the tables"). A screen describes its filters as
  `SearchSpec`s — `text` (sent as `q`), `choice` (a client, account, status…),
  `dates` (presets + custom), `range`, `input` (one date/number). Typing offers
  "بحث في <field> عن: …" plus matching options (Arabic-folded: hamza forms, ة/ه,
  ى/ي, diacritics); Enter or a click makes a removable facet; Backspace in an
  empty box drops the last one; the فلاتر menu holds short option lists, date
  presets and ranges. The component owns **no** filter state: each screen keeps
  its `useState`s and server-side fetch, and passes `values` + `onChange(patch)`
  through a key→setter map. Unlike the old row, a pick applies on Enter/click,
  not per keystroke.
- `components/Filters.tsx` — `ResultCount`, `ExportButtons`, `PrintButton`,
  `PrintFooter`, `BackToTop`, `useClampedOffset`. Every filter change rewinds
  paging, and `useClampedOffset` walks the offset back when the total shrinks
  under it — void the only receipt on page 41 of 41 and the list would
  otherwise sit on an empty page.
- `lib/paging.ts` — rows per page. Every paged list has a عدد الصفوف menu
  (50/100/250/500/**الكل**) in its `Pager`, remembered per screen in
  `localStorage`. "الكل" asks for `ALL_ROWS` = 10,000, which must equal
  `MAX_PAGE_SIZE` in `backend/app/api/common.py` (the API's cap; above it is a
  422). All 2,041 receipts come back in ~0.5s. CSV export writes what is on
  screen, so "الكل" is also how to export everything. Pickers and reports that
  must never truncate (client lists, account pickers, حركة الصندوق, buildings)
  ask for `ALL_ROWS` directly.
- `lib/export.ts` — CSV download. The UTF-8 BOM is not optional: without it
  Excel reads the file in the local codepage and every Arabic name is mojibake.
  Fields that start with `=`, `+`, `-` or `@` are prefixed with an apostrophe
  so Excel does not evaluate them as formulas.
- `app/print.css` — the print stylesheet, **deliberately not in globals.css**:
  that file is a verbatim port of `erp-ui-design.html` and gets re-ported when
  the design changes; nothing here belongs to the mockup, so nothing here
  should be lost to a re-port. Mark screen-only controls `no-print` — and keep
  the `.no-print` rule itself **inside** `@media print`. Outside it, it hides the
  filter bars, row actions and report cards on screen too, which is exactly what
  happened for several turns; a curl check returns 200 either way, so verify UI
  changes in a real browser.

**An empty list cannot tell you why it is empty, so the screen has to.** Every
list filter is server-side, which means `total` comes back 0 both when nothing
exists and when nothing matched — so "لا وصولات — سجّل أول وصل قبض" appeared over
a ledger holding 2,041 of them. Each list screen now derives a `filtered`
boolean from its own filter state and branches the empty state on that; only the
unfiltered case offers the "add the first one" button.

**Every "PDF" in this app is that stylesheet plus the browser's Save-as-PDF.**
There is no PDF library and the app still has no runtime dependency beyond Next
and React. A client-side PDF writer would have to ship an Arabic font and do
its own bidi shaping to render `ثمانون ألفاً دولار`; Chrome and Edge already do
it perfectly against the same CSS the screen uses.

`components/Voucher.tsx` is the printable سند قبض / سند صرف at
`/receipts/{id}/print` and `/payments/{id}/print` — one layout for both, since
they differ only in the title and the party line. It is laid out like a
receipt book and is **black and white on screen as on paper** (client request,
2026-09-26): letterhead with the title boxed (سند قبض / RECEIPT VOUCHER),
number and date boxes, a double-ruled amount box, dotted fill-in lines
(استلمنا من / مبلغاً وقدره / وذلك عن), a ruled details grid, signature lines.
Hierarchy comes from rules and weight, never colour — vouchers get photocopied.
In that grid, put `mono` on a `<span>` inside the cell, never on the `<td>`:
`direction:ltr` on a cell of an RTL table breaks the collapsed borders.

Every other printout is monochrome too: `print.css` forces black text, no
backgrounds, `print-color-adjust: economy`, grayscale logos, black-ruled table
headers, and pills as bordered text. Debit/credit stay legible from their
columns and signs, not their green/red. It writes the
amount in words with `lib/tafqeet.ts`; every voucher the office has ever issued
carries one (the legacy `RECEIPT.COMMENT` column held it, handwritten). The
group word follows the last two digits of the number, which is why ٢٣٤ ألفاً but
٢٠٠ ألف and ١٠٥ آلاف.

Filtering splits along one line: anything that changes what the *server* must
compute (dates on a statement fold into the opening balance; a period on the
ميزان changes the sums) is a query parameter. Anything that only narrows rows
already fetched — a text box over 593 accounts, a type filter on a statement —
filters in the browser so typing stays instant. When a client-side filter is
active the running balance and the closing total still count every movement,
and the screen says so.

### Searching by name

Every browse screen searches the thing the office actually remembers — the
person — not just the document number:

| Screen | `q` matches |
| --- | --- |
| العملاء | name (ar/en), account code, phone, national id, **project, block** — plus `balance=debit\|credit\|zero` and `sort=balance_desc\|balance_asc` |
| الوصولات / المدفوعات | document no, **printed voucher no. (`ref_no`)**, **client / beneficiary name**, note, cheque no |
| قيود اليومية | entry no, description, **account name or code**, line description |
| العقود | contract no, **client name**, unit no |
| الوحدات | unit no, **building name or code** |
| الأبنية | name, code, city |
| دليل الحسابات / الميزان | code or name (in the browser — the chart is already loaded) |

The journal one is the widest: `q=شور` finds all 146 entries touching that
client's account, `q=الصندوق` all 2,053 that touched the till. It resolves names
through a subquery over `journal_lines → accounts` rather than joining, so an
entry with two matching lines still counts once.

Client pickers are `components/SearchSelect.tsx`, an `<input>` over a native
`<datalist>`: 189 clients in a `<select>` is a scroll-and-squint exercise, and
the office knows the name, not the alphabetical position. Options render as
`name — account code` so two clients sharing a name stay distinguishable, and
text matching no option resolves to "nothing selected" rather than silently
keeping the last pick.

### Type scale

The mockup was drawn at 14px body / 13px table / 11px label — right for a design
comp, tight for an accountant reading Arabic on an office monitor all day, and
Arabic needs more vertical room than Latin at the same nominal size. The scale-up
(15px body, 14px tables, taller rows) lives at the **bottom** of globals.css with
the other app-only additions, so re-porting the design keeps it. Since 2026-09-27
`app/theme.css` sits on top of both (15px Cairo body, 14.5px tables) — see
"The redesign of 2026-09-27".

### Feedback, confirmation, scrolling

- `components/Toast.tsx` — `useToast().ok/err`. Every save, void and delete says
  so now; before, success was silent and failures went into a box above the fold.
  Errors stay until dismissed (they carry a message worth reading twice);
  successes fade.
- `components/Confirm.tsx` — `useConfirm()`, promise-based, so call sites stay
  flat: `if (!(await confirm({...}))) return;`. It replaced `window.confirm`,
  which rendered a Latin-chrome LTR box with browser-language buttons in the
  middle of an Arabic screen, and left no room to say what voiding actually
  does. Outside the provider it falls back to `window.confirm` rather than
  confirming silently.
- **Tables use the whole page** (2026-09-26). Above 1080px the content has no
  max width and `.tbl-wrap` has no height cap and `overflow:visible`: the page
  scrolls, and the header pins against the viewport at `top:60px`, under the
  sticky topbar. That only works because no ancestor is a scroll container —
  `overflow-x:auto` would turn into `overflow-y:auto` and trap the sticky
  header inside the box again. Between 760 and 1080px the old capped scroll box
  returns (wide tables need horizontal scroll there); below 760px the page
  scrolls with a static header. Tables inside a `.modal` keep their own box.
  Rules live at the bottom of globals.css with the other app-only additions.
- Print options (orientation, paper size) live behind the ⌄ next to طباعة and
  are written into an `@page` rule by `setPageStyle` — the only thing a page can
  say about paper, and not settable inline.

### Access rights (dynamic, 2026-09-27)

Roles are data, not code. `roles` (migration `0007`) holds a name and a JSONB
list of permission codes; each user has one `role_id`. The old `users.role`
enum and `user_role` type are gone — `0007` mapped every user to the role of
the same code, and seeded the four starting roles with exactly the rights they
had (accountant 35, sales 22, viewer 11 of 37).

- **The catalog** — `app/core/permissions.py`: every permission is
  `<module>.<action>` (dashboard, buildings, units, clients, contracts,
  schedule, receipts, payments, journal, accounts, reports, settings × view /
  create / edit / delete / activate / manage / void / post / users / org /
  rates). Code decides which permissions exist and which endpoint needs which;
  *who* holds them is edited in الإعدادات ← الأدوار والصلاحيات. Adding a
  permission means adding it to `CATALOG`, gating the endpoint, and deciding
  whether existing roles should get it (write a migration if so).
- **Enforcement** — `require_perm(*codes)` in `app/core/deps.py` passes when
  the user holds ANY of the codes; it rejects unknown codes at import time.
  **Every endpoint is gated, reads included.** List endpoints that other
  screens use as pickers name those screens' permissions too (the client list
  also opens for `receipts.create`, `contracts.create`…), so a cashier can pick
  a client without being able to read statements. The deliberately open
  routes are: login, `/auth/me`, own password change, the permission catalog,
  currencies / exchange-rate reads, the letterhead (`GET /org-settings`, every
  printout needs it) and `/health`. To audit: walk `app.routes` and look for
  the `_check` closure (done 2026-09-27: 65 of 74 gated, the 9 above open).
- **Immediate** — permissions are read from the user's role on every request
  (`User.role` is `lazy="joined"`), never from the token, so an edit applies to
  the next API call. The frontend re-reads `/api/auth/me` on window focus and
  every 60 s, so menus and buttons follow within a minute.
- **Cannot lock itself out** — the system role (`is_system`, code `admin`)
  holds every permission including future ones and cannot be edited or
  deleted; a role still assigned to users cannot be deleted; the last active
  user with the system role cannot be demoted or deactivated; nobody can
  deactivate themselves.
- **Frontend** — `can(...permissions)` (any-of, `lib/auth.tsx`) decides what a
  screen offers; the menu lists only screens whose `permission` the user holds
  (`Shell.tsx` NAV); a screen opened by URL without it shows "ليست لديك صلاحية";
  a user without `dashboard.view` lands on their first permitted screen. The
  role editor (settings `RolesPanel`) shows every module with its actions as
  chips; ticking an action ticks the module's view, unticking view clears the
  module. `tests/test_permissions.py` pins the backend half.

### Monthly payment reminders (التنبيهات, 2026-09-27)

The office sets **one day of the month** (1–28, الإعدادات ← التنبيهات); from
that day every client who owes and has not paid this month is "late" — red in
العملاء, a red banner on their statement, listed on `/alerts`, counted by the
bell in the top bar and the menu badge, and announced once per cycle per user
by an alarm window. Recording a receipt clears it; nothing is scheduled.

- **Computed live** in `app/services/reminders.py` (`compute(db, as_of)`),
  never stored per month. A *cycle* opens on the alert day and runs to the next
  month's alert day; before the alert day the previous month's cycle is still in
  force, so a client who missed last month does not vanish on the 1st.
- **Late** = the client already owed (above `alert_settings.min_balance`) on
  the **first day of the cycle's month**, still owes, and in that month paid
  nothing — or less than `clients.monthly_installment` when set — or an active
  contract installment is past due and unpaid. Owed-at-month-start is what keeps
  a client who bought on the 15th from being late the same month. The rule lives
  in `services/collection.py` and is shared with the dashboard rate and جدول
  الدفعات — see the next section. Sorted by months since the last receipt
  (never-paid first).
- **Storage** (migration `0008`): `alert_settings` (one row: enabled,
  alert_day, min_balance), `client_reminders` (the office's "تم التذكير" mark,
  one per client per month, with a note), `clients.monthly_installment`.
- **API** `app/api/alerts.py`: `GET /api/alerts` (list), `/summary` (bell),
  `/clients/{id}` (statement banner), `POST|DELETE /clients/{id}/remind`,
  `GET|PUT /settings`. Permissions `alerts.view`, `alerts.manage`,
  `settings.alerts` (0008 grants them to the starting roles). The clients list
  carries `late` / `months_unpaid` per row from the same `compute()`.
- On the real ledger (September 2026, alert day 1): 130 of 189 clients late,
  $4,688,080 owed — the imported history stops in December 2025, so every
  debtor is "late" until receipts are recorded again.
- `tests/test_reminders.py` pins the cycle boundaries, receipt clearing /
  voiding, short payments, minimum balance, switch-off, reminder marks and the
  permissions.

### Collection rate, جدول الدفعات and bulk entry (2026-09-28)

One rule answers "who paid this month", in `app/services/collection.py`, and
three screens read it — the alerts, the dashboard's paid-this-month ring and
the payment grid — so they cannot disagree (on the real ledger, December 2025:
40 of 126 owing clients paid, 31.75 %, the same 126 − 40 the alerts list).

- **`Snapshot(db, as_of)`** loads clients, per-day ledger nets and receipts in
  three queries (live entries only); `month(client, window)` gives
  `owed_at_start`, `paid`, and a status: `paid` / `short` (below the monthly
  installment) / `unpaid` / `settled` (owed nothing, or cleared it) / `before`
  (no charge yet) / `future`. Late = `short` or `unpaid`.
- **`GET /api/reports/collection?months=6&as_of=`** (`dashboard.view` |
  `reports.view`) — per month: owing at start, paid, late, rate, amount
  collected, expected (sum of installments). In the running month, clients with
  an overdue contract installment count as late too, as in the alerts.
- **`GET /api/schedule/grid?year=&as_of=&q=&only_late=&project=`**
  (`schedule.view` | `receipts.view`) — a client × 12 months grid of those
  statuses and amounts, totals per month, the project list for the filter.
  `year` defaults to `as_of.year`; a past `as_of` (2025-12-31) shows a finished
  year with no `future` cells. 154 rows in ~0.1 s. The imported history stops in
  December 2025, so the current month reads 0 % until receipts are entered again.
- **`POST /api/receipts/bulk`** (`receipts.create`) — one date, till, currency
  and method for many `{client_id, amount, contract_id?, ref_no?, cheque_no?,
  notes?}`. What the lines share is checked first (not a till, unknown currency,
  no FX rate → one 400, nothing written); each line then runs the single-receipt
  path — GL, schedule allocation, audit — in its own savepoint, so a bad line is
  reported in `failures` by index and the rest commit. `test_bulk.py` forces a
  failure after a line's entry is flushed and checks that nothing of it remains.
- **`POST /api/alerts/remind/bulk`** (`alerts.manage`) — mark many clients
  reminded in the current cycle; unknown ids come back in `missing`.
- **Preferences** (migration `0009`, `users.preferences` JSONB) — theme
  (`light` default / `dark` / `auto`), `lang`, `simple_mode`, on the user so
  they follow the person to any PC. `GET /api/auth/me` carries them with the
  defaults filled in; `PUT /api/auth/preferences` is a partial update of your
  own, ungated like the password change. Each stored key is validated on its
  own, so a bad value falls back alone and never breaks `/me`.

### Settings, users and the letterhead

`/settings` has five tabs, each opened by a permission; only **حسابي** is open to
everyone, and that is the point of it:

- **المستخدمون** (`settings.users`) — create, edit role and name, reset someone's password,
  deactivate and reactivate. Search, a role filter and an active-only filter,
  because a real office accumulates leavers.
- **الأدوار والصلاحيات** (`settings.users`) — create, copy, edit and delete roles;
  the permission editor. See "Access rights".
- **حسابي** (everyone) — change your own password. `POST /api/auth/change-password`
  is the one user operation that is not gated by a permission: an accountant must be able
  to change their own password without asking the administrator, and the shipped
  `admin` account otherwise has no way to stop being `admin123`. It requires the
  current password, so a borrowed session cannot lock the owner out, and it signs
  you out afterwards so the new password is proved on the way back in.
- **بيانات المنشأة** (`settings.org`) — the letterhead, with a live preview of the voucher
  heading beside the form.
- **أسعار الصرف** (`settings.rates`) — the office quotes "ل.ل per dollar"; the schema stores
  the inverse, and the form shows what it is about to store.

**The letterhead lives in the database** (`org_settings`, migrations `0003`/`0004`,
one row forced by a check constraint) rather than in the frontend bundle or a
browser's storage: two clerks printing the same receipt must produce the same
piece of paper. `lib/org.ts` survives as the floor `useOrg()` falls back to —
printing must never fail because a settings fetch did. The name currently in the
database, `المهدي للإنماء والإعمار`, is the one the legacy `CONFIGS.csv` carried.

The **logo is stored inline** as a `data:image/…;base64,…` URI in that same row,
capped at ~400 KB of base64 and validated to be an image. The app has no file
store, and a letterhead that travels with a `pg_dump` is one that still prints
after a restore — a backup that loses the logo cannot reproduce last year's
receipts. It renders in the voucher sheet and in `<PrintHeader>`.

`<PrintHeader>` sits in `Shell`, so **every** screen prints with the firm, the
screen's name and the date without each screen repeating it; `print.css` hides
the on-screen `.head` wherever a letterhead precedes it, and hides the letterhead
itself on voucher pages (`body:has(.sheet)`) where the sheet carries its own.

### Reports

ميزان المراجعة (all-time or a period), كشف حساب, دفتر الأستاذ and دفتر اليومية
are screens of their own. Five more open inline on التقارير: أرصدة العملاء,
حركة الصندوق, تقرير المبيعات, الملخّص الشهري, توافر الوحدات. All of them filter,
export to CSV and print.

**التقارير opens on كشف الأرصدة (or the report `?r=` names), never on an empty grid.** A screen of nothing
but buttons reads as broken, and that is the first report an office opens anyway.
The cards select rather than toggle, so clicking the open one cannot blank the page.

The last two are server-side: `GET /api/reports/sales` and `/api/reports/monthly`.
Sales take the amount from the **debit on the client's own receivable**, not the
revenue credit — that is the figure the client was charged, and it stays right
when an entry splits revenue across several accounts (VAT, discounts) instead of
counting each line. The monthly summary reads cash off the accounts flagged
`is_cash_bank`, so an entry that never touched the till cannot inflate a month.

### Editing records

Master data is editable in place: clients, buildings, units, accounts, and the
patchable half of a contract. One form serves create and edit wherever the
fields are the same; where they are not, the difference is the point:

- **An account's code is not editable.** It is the key every posting, report
  and configured special account refers to, and `AccountUpdate` leaves it out.
- **A contract's number, client, unit and type are fixed after creation** —
  the activation posting and the payment schedule were built from them.
  `ContractEditForm` offers only what `ContractUpdate` accepts, and says
  plainly that changing an amount does not re-post the GL.
- **Receipts and journal entries are not editable at all, by design.** There is
  no PATCH for either. A posted document is voided and reissued, which is what
  the void path already does (reverse the allocation, soft-delete the entry).
  Adding an edit would let someone change a figure the ledger has already
  reported.
- **`DELETE /api/journal/{id}` takes the database id, not the entry number.**
  In `realestate_erp_full` ids 1 and 2 are `LEG-7` and `LEG-8`, so "delete
  entry 1" voids a real 2019 sale. The response names what it actually voided
  (`{"detail":"Entry LEG-7 deleted"}`) — read it. There is no un-void endpoint
  by design; recovering means flipping `is_deleted` back through the models.
- Deleting is soft everywhere, and the confirmation says what survives: the
  client's account and its ledger history stay exactly as they were.

## Next steps

1. **Change the admin password** — `realestate_erp_full` carries the client's
   real ledger and still logs in with `admin` / `admin123`.
2. **Buildings, units and contracts — the source data does not exist yet.**
   Worth knowing before anyone goes looking again: the old system had no
   contract table and no unit register. `SITEMS`/`ALLITEMS` carry one row per
   sale (145) with a `CATEGORY1` like `"432/B"`, and that is the *building*,
   not the unit — seventeen different buyers share `432/B`, and 38 of the 145
   rows leave it blank. The only per-unit information anywhere is Arabic free
   text in the journal descriptions ("شراء شقة عقار 834 طابق اول غربي").
   So the property screens stay empty until the client supplies a unit
   register, or their accountant maps sale → unit by hand. Inventing unit
   numbers from that free text would put fiction in a property register.
   (`NABIL` is item movements, not clients — clients come from the `411xxxxx`
   leaves of `ACCOUNTMAP`.)
3. **Schedule the nightly job** — batch rent invoicing and the overdue status
   are built (see "Rent invoicing and overdue status"); nothing runs them
   automatically yet. Add a daily Task Scheduler entry for
   `python -m app.jobs.nightly` once real contracts exist.

---

## Demo data

This describes `realestate_erp`, the demo database — not
`realestate_erp_full`, which carries the real imported ledger.

The demo database is seeded with a demo set created **through the public API**
(`admin` / `admin123`): 3 buildings, 7 units, 5 clients, 3 sale contracts plus
one lease with four invoiced periods, 5 receipts and 2 expense payments. The
trial balance comes to $359,850 on both sides.

Rebuild it any time with `python -m app.seed.demo` (see `backend/app/seed/demo.py`);
it drives the public API, so it needs the server running and `app.seed.run`
already applied. Never run it against production.
