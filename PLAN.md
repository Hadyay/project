# Plan — ERP enhancement round (2026-09-28)

Status: **awaiting the owner's approval (§6). Nothing new is implemented yet.**
Two Claude sessions work on this at the same time, split by layer:

- **Backend agent** — the session that messaged first ("Project analysis and
  setup", pipe `…a6d9202a…`): finishes the payment reminders, then owns
  everything under `backend/`.
- **Frontend agent** — this session: owns everything under `frontend/` once
  the reminders are handed over.

Rules for working side by side are in §5. API contracts are in §4 — neither
side codes against an endpoint that is not written down there.

---

## 0. Where things stand

- Payment reminders (التنبيهات) are done in code: backend, migration `0008`,
  59 tests passing, bell + alarm + alerts page + red marks + settings tab all
  verified in the browser; the typecheck is clean again (checked 2026-09-28).
  **Left:** CLAUDE.md section and a new package → backend agent, on approval.
- **All of `frontend/` now belongs to the frontend agent**, including the
  reminder files (handed over by message).
- **The database container `project-db-1` is stopped** (exited 2026-09-27).
  Backend tests skip and the app has no data until Docker Desktop is running
  and `docker compose up -d db` is run — the backend agent does this first.
- The project is **not a git repository**. Proposal (needs the owner's yes):
  `git init` + a baseline commit right after the reminders are finished, then
  small commits per agent, so every change is visible and reversible.

---

## 1. What the owner asked for → what we will build

| # | Request | Deliverable | Who |
|---|---|---|---|
| 1 | جدول الدفعات connected to the payments | Monthly payment grid fed by the receipts + contract-installments tab (§2.2) | grid API: backend · screen: frontend |
| 2 | Invoicing + receipts simple, **bulk** | Bulk receipt entry ("تسجيل دفعات الشهر"), bulk remind, bulk voucher print (§2.8) | API: backend · screen: frontend |
| 3 | Professional, modern, simple, friendly | Page-header pattern, cards, empty states, skeletons, **simple mode** (§2.6) | frontend (+ prefs API) |
| 4 | Statement: all clients, choose or search | Two-pane كشف حساب (§2.4) | frontend |
| 5 | More professional settings | Side-navigation settings with grouped sections (§2.5) | frontend |
| 6 | Dark / white | Light / dark / follow Windows (§2.3) | frontend |
| 7 | Really clear reports | Reports hub + new collection report (§2.7) | API: backend · screen: frontend |
| 8 | % of clients paid this month | Collection ring + 6-month trend on the dashboard (§2.1) | API: backend · screen: frontend |
| 9 | Dashboard = the main of the system | Dashboard rebuilt as the hub (§2.1) | frontend |

---

## 2. Design

### 2.1 Dashboard — the hub
- Greeting + date, and a **big client search**: type a name / code / phone →
  straight to that client's statement.
- **Ring: "X% من العملاء دفعوا هذا الشهر"** — of the clients who owed at the
  start of the month, how many paid (the full monthly installment, when one is
  set); amount collected; change vs last month. Beside it a **6-month trend**.
- **Late clients panel** — top 5 from التنبيهات, phone, months late,
  one-click "تم التذكير" / "قبض".
- Existing figures, tills and latest receipts, re-laid out calmer.

### 2.2 جدول الدفعات — connected to the payments
The real data has no contracts (the old system had none) but 2,041 receipts,
so the schedule is built from them:
- **Tab 1 — دفعات العملاء الشهرية:** rows = clients, columns = the 12 months
  of a chosen year; cell = paid that month (green), **red "لم يدفع"** where the
  client owed and paid nothing, grey before the first charge. Row totals,
  column totals, **% paid per month**. Search, late-only, project filter,
  export, print. Click a cell → that month's receipts; row button → new receipt.
- **Tab 2 — أقساط العقود:** today's installment view, for real contracts later.

### 2.3 Dark / white
`data-theme="light|dark"` on `<html>`, "تلقائي" follows Windows. All colors
become tokens: `--bg --surface --surface-2 --text --muted --border
--border-soft --accent --accent-soft --danger --danger-soft --success
--success-soft --warning --zebra --hover --head-bg`. globals.css (the mockup
port) gets dark *overrides*, not edits. Print always light; report sheets and
vouchers stay white "paper" on screen.

### 2.4 كشف حساب — all clients, choose or search
Left: all 189 clients with balance and red late badge; search (name, code,
phone, project, Arabic-folded); filters all / owes / late. Right: the statement
sheet. URL `/statement?client=ID`. Phone width: list first, then statement.

### 2.5 Settings, professional
Side navigation with icons, grouped: **حسابي** (الملف الشخصي، كلمة المرور،
المظهر) · **المنشأة** (بيانات المنشأة، أسعار الصرف، التنبيهات) · **المستخدمون
والصلاحيات** (المستخدمون، الأدوار). Each section: title, one-line description,
two-column form, sticky save bar only when something changed.

### 2.6 Simple mode + per-user preferences
**الواجهة المبسّطة**: the menu shows only لوحة التحكم، العملاء، كشف حساب،
الوصولات، المدفوعات، جدول الدفعات، التنبيهات، التقارير; the accounting
screens go under "المزيد". Permissions unchanged. Theme, language and simple
mode are saved **on the user** (they follow the person to any PC).

### 2.7 Reports, really clear
Reports hub with a grouped side list — **مالية** (ميزان المراجعة، كشف الأرصدة،
حركة الصندوق) · **التحصيل** (تقرير التحصيل الشهري *new*، العملاء المتأخرون) ·
**المبيعات** (تقرير المبيعات، الملخّص الشهري) · **العقارات** (توافر الوحدات) —
each with a one-line "what this answers", totals, legacy-paper print, CSV.

### 2.8 Bulk operations
- **تسجيل دفعات الشهر**: from جدول الدفعات or التنبيهات, a sheet of clients
  with an amount box each → one "حفظ الكل" posts every receipt (each on its
  own, same allocation and ledger entries as a single receipt), then shows
  what was created and what failed, with a "print all vouchers" button.
- **Bulk "تم التذكير"** on the alerts list.
- **Invoicing:** sale clients are already charged the full price when the sale
  is activated, so monthly "invoices" to them would double-charge. Bulk
  invoicing stays **rent-only** (the existing invoice-due run) unless the
  owner says otherwise.

### 2.9 Polish everywhere
One page-header pattern, friendly empty states, loading skeletons, consistent
buttons — applied screen by screen by the frontend agent.

---

## 3. Order of work

1. Backend agent: reminders docs → start the database → (if approved) git baseline.
2. Backend: preferences (0009) → collection endpoint (+ reminders.py on the
   month-start rule) → grid endpoint → bulk receipts + bulk remind, each with
   tests; each contract announced by message with an example response.
3. Frontend, meanwhile: color tokens + dark mode first (everything builds on
   them) → settings + المظهر → statement two-pane → simple mode → then the
   dashboard, جدول الدفعات, bulk entry and reports as their endpoints land.
4. Together: English dictionary for all new strings, browser check of every
   screen in light/dark × Arabic/English, production build (in a copy),
   CLAUDE.md, new package.

---

## 4. API contracts (backend implements, frontend consumes)

1. **Preferences** — migration `0009` `users.preferences` JSONB.
   `GET /api/auth/me` adds `preferences: {theme: "light"|"dark"|"auto", lang: "ar"|"en", simple_mode: bool}`.
   `PUT /api/auth/preferences` (own user only, partial) → full preferences.
   Both open to any signed-in user.
2. **Collection rate** — `GET /api/reports/collection?months=6&as_of=`
   (dashboard.view or reports.view) → `{as_of, current: Month, months: [Month]}` (oldest → newest),
   `Month = {period, owing_at_start, paid, late, rate (0–100), amount_collected, expected|null}`.
   - **"Owing" = owed at the start of the month** (balance on the month's first
     day > `min_balance`). reminders.py changes to the same rule, so the ring
     and the alerts list always agree — and a client who buys mid-month is no
     longer shown late in their first month (a real bug today).
   - `late = owing_at_start − paid`. "This month" = the **calendar** month of
     `as_of`. Before the alert day the alerts list still shows last month's
     cycle, so **the ring is always labelled with its `period`** — the UI
     must never imply the two are the same month on days 1…alert_day−1.
3. **Payment grid** — `GET /api/schedule/grid?year=&q=&only_late=&project=`
   (schedule.view or receipts.view) → `{year, months, rows: [{client_id, code, name,
   phone, project, block, balance, monthly_installment, first_charge_date, late,
   cells: [{period, paid, receipts, status}], total_paid}],
   totals: [{period, paid_amount, paid_clients, owing_clients, rate}]}`.
   `status`: `paid` · `short` (below installment) · `unpaid` (owed, paid
   nothing — **red**) · `settled` (owed nothing, paid nothing — neutral grey) ·
   `before` (before the first charge) · `future`. `late` = late in the current
   cycle. Default sort: most unpaid months first. Cell click-through uses the
   existing `GET /api/receipts?client_id=&date_from=&date_to=` — no new API.
4. **Bulk receipts** — `POST /api/receipts/bulk` (receipts.create)
   `{receipt_date, cash_account_id, currency_id, method, post = true, lines: [{client_id, amount, ref_no?, notes?}]}`
   → `{created: [{client_id, receipt_id, receipt_no}], failures: [{client_id, detail}], count, total_amount}`.
   Cash account, currency and exchange rate are validated **once, up front**
   (400 before any line is written); each line then reuses the single-receipt
   service (allocation + GL + audit) in its own savepoint.
   **Bulk remind** — `POST /api/alerts/remind/bulk {client_ids, note?}` (alerts.manage).
   **Print all vouchers** — frontend only: `/receipts/print?ids=1,2,3`
   renders one voucher per id, page-broken.

---

## 5. Working side by side

- **Ownership:** `backend/**` → backend agent. `frontend/**` → frontend agent,
  **after** "reminders done" (until then the frontend agent does not touch
  `lib/i18n-en.ts`, `lib/alerts.ts`, `app/(app)/alerts/`, `components/Shell.tsx`,
  `app/theme.css`). `lib/types.ts` mirrors the backend schemas — written by the
  frontend agent from §4.
- **Contracts change only by message** — never by surprise.
- **Servers:** only the backend agent restarts uvicorn (Windows `--reload`
  hangs). Nobody runs `npm run build` into `frontend/.next` while the dev
  server runs — build a copy.
- **Real data:** no test records in `realestate_erp_full`; use the test
  database, or remove what was created and say so.

---

## 6. Decisions needed from the owner

1. **Simple mode** — is the everyday list in 2.6 right?
2. **"% paid this month"** — of clients who owed at the start of the month,
   how many paid (installment respected when set). OK?
3. **git** — OK to make the project folder a local git repository (nothing
   uploaded) so both agents' changes are tracked and reversible?
4. **Bulk invoicing** — keep it rent-only (sale clients are already charged in
   full at the sale)? Or did you mean something else by "invoicing"?
