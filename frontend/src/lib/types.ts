/** Mirrors backend/app/schemas — keep in step when the API changes.
 *  Money arrives as a JSON string (Decimal), never a float. */

export type Money = string;

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type ApartmentType = "apartment" | "shop" | "office" | "storage" | "land" | "other";
export type ApartmentStatus = "available" | "reserved" | "sold" | "rented" | "unavailable";
export type ContractType = "sale" | "rent";
export type ContractStatus = "draft" | "active" | "completed" | "cancelled" | "terminated";
export type ScheduleStatus = "pending" | "partial" | "paid" | "overdue" | "cancelled";
export type EntryType =
  | "opening" | "sale" | "rent_invoice" | "receipt" | "payment" | "adjustment" | "transfer";
export type PaymentMethod = "cash" | "bank_transfer" | "cheque" | "card" | "other";

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** A permission code, "<module>.<action>" — the catalog is GET /api/roles/permissions. */
export type Permission = string;

export interface RoleBrief {
  id: number;
  code: string;
  name: string;
  is_system: boolean;
}

export interface User {
  id: number;
  username: string;
  full_name: string | null;
  role_id: number;
  role: RoleBrief;
  is_active: boolean;
  created_at: string;
}

/** GET /api/auth/me — the signed-in user and what they may do. Mirrors schemas.auth.Me. */
export interface Me extends User {
  permissions: Permission[];
  /** Absent from a backend older than migration 0009. */
  preferences?: Preferences;
}

/** The user's interface choices. Mirrors schemas.auth.Preferences. */
export interface Preferences {
  theme: "light" | "dark" | "auto";
  lang: "ar" | "en";
  simple_mode: boolean;
}

/** A role and its permissions (the system role lists every one). Mirrors schemas.auth.RoleOut. */
export interface Role {
  id: number;
  code: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  is_system: boolean;
  user_count: number;
}

export interface PermissionModule {
  module: string;
  label: string;
  actions: { code: Permission; action: string; label: string }[];
}

export interface Currency {
  id: number;
  code: string;
  name_ar: string;
  name_en: string;
  symbol: string | null;
  is_base: boolean;
}

export interface ExchangeRate {
  id: number;
  currency_id: number;
  rate_date: string;
  rate_to_base: Money;
}

export interface Account {
  id: number;
  code: string;
  name_ar: string;
  name_en: string | null;
  parent_id: number | null;
  account_type: AccountType;
  is_client: boolean;
  is_cash_bank: boolean;
  is_postable: boolean;
  currency_id: number | null;
  created_at: string;
}

export interface AccountTreeNode extends Account {
  children: AccountTreeNode[];
}

export interface TrialBalanceRow {
  account_id: number;
  code: string;
  name_ar: string;
  total_debit: Money;
  total_credit: Money;
  balance: Money;
}

export interface UnitCounts {
  total: number;
  sold: number;
  rented: number;
  reserved: number;
  available: number;
  unavailable: number;
}

export interface Building {
  id: number;
  code: string | null;
  name: string;
  address: string | null;
  city: string | null;
  floors_count: number | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface BuildingWithCounts extends Building {
  units: UnitCounts;
}

export interface Apartment {
  id: number;
  building_id: number;
  unit_no: string;
  floor: number | null;
  area_m2: Money | null;
  unit_type: ApartmentType;
  status: ApartmentStatus;
  listed_price: Money | null;
  price_currency_id: number | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApartmentWithBuilding extends Apartment {
  building_name: string | null;
  price_currency_code: string | null;
}

export interface Client {
  id: number;
  code: string | null;
  name_ar: string;
  name_en: string | null;
  national_id: string | null;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  address: string | null;
  /** From the legacy customer card: المشروع والعقار, بلوك, طابق / جهة. */
  project: string | null;
  block: string | null;
  floor_side: string | null;
  /** Expected monthly payment (القسط الشهري); paying less in a month counts as late. */
  monthly_installment: Money | null;
  notes: string | null;
  account_id: number | null;
  created_at: string;
  updated_at: string;
}

/** A row of العملاء: the client plus its receivable balance in base currency
 *  (positive — the client owes; negative — paid ahead). Mirrors ClientListItem. */
export interface ClientListItem extends Client {
  balance_base: Money;
  /** Late in the reminder cycle in force today (see AlertsReport). */
  late: boolean;
  months_unpaid: number | null;
}

/* ---------------------------------------------------------- reminders */

export interface AlertSettings {
  enabled: boolean;
  alert_day: number;
  min_balance: Money;
  updated_at: string;
}

export interface LateClient {
  client_id: number;
  code: string | null;
  name: string;
  phone: string | null;
  project: string | null;
  block: string | null;
  floor_side: string | null;
  balance: Money;
  monthly_installment: Money | null;
  paid_this_cycle: Money;
  last_payment_date: string | null;
  /** Whole months since the last receipt; null = never paid. */
  months_unpaid: number | null;
  overdue_installments: number;
  overdue_amount: Money;
  reason: "no_payment" | "short" | "overdue_installment";
  reminded_at: string | null;
  reminded_by: string | null;
  reminder_note: string | null;
}

export interface ReminderCycle {
  period: string;
  start: string;
  alert_date: string;
  next_alert_date: string;
  is_alert_day: boolean;
}

/** GET /api/alerts — mirrors schemas.alerts.AlertsReport. */
export interface AlertsReport {
  enabled: boolean;
  alert_day: number;
  min_balance: Money;
  as_of: string;
  cycle: ReminderCycle;
  count: number;
  reminded_count: number;
  total_balance: Money;
  rows: LateClient[];
}

export interface AlertsSummary {
  enabled: boolean;
  alert_day: number;
  period: string;
  alert_date: string;
  is_alert_day: boolean;
  count: number;
  reminded_count: number;
  total_balance: Money;
}

export interface RentInvoiceRun {
  as_of: string;
  invoiced: number;
  skipped: number;
  entry_nos: string[];
  failures: { contract_no: string; seq_no: number; detail: string }[];
}

export interface OverdueRefresh {
  as_of: string;
  marked_overdue: number;
  cleared: number;
}

export interface ClientBalance {
  client_id: number;
  total_debit: Money;
  total_credit: Money;
  balance: Money;
  entry_count: number;
  last_payment_date: string | null;
}

export interface StatementLine {
  entry_id: number;
  entry_date: string;
  entry_no: string;
  entry_type: EntryType;
  line_desc: string | null;
  /** The other accounts in the same entry — what the amount was booked against. */
  counterpart: string | null;
  /** Receipt or payment number, when a voucher raised the entry. */
  document_no: string | null;
  currency_code: string | null;
  debit: Money;
  credit: Money;
  debit_base: Money;
  credit_base: Money;
  running_balance_base: Money;
}

export interface ClientStatement {
  client: Client;
  opening_balance: Money;
  lines: StatementLine[];
  closing_balance: Money;
}

export interface Contract {
  id: number;
  contract_no: string;
  contract_type: ContractType;
  client_id: number;
  apartment_id: number;
  currency_id: number;
  status: ContractStatus;
  sign_date: string | null;
  start_date: string | null;
  end_date: string | null;
  total_amount: Money | null;
  down_payment: Money | null;
  installment_count: number | null;
  monthly_rent: Money | null;
  deposit: Money | null;
  billing_day: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractDetail extends Contract {
  client_name: string | null;
  building_name: string | null;
  unit_no: string | null;
  currency_code: string | null;
  paid_total: Money;
  outstanding_total: Money;
}

export interface ScheduleRow {
  id: number;
  contract_id: number;
  seq_no: number;
  due_date: string;
  amount: Money;
  currency_id: number;
  paid_amount: Money;
  status: ScheduleStatus;
}

export interface OverdueRow {
  id: number;
  contract_no: string;
  contract_type: ContractType;
  client_id: number;
  client_name: string;
  due_date: string;
  amount: Money;
  paid_amount: Money;
  outstanding: Money;
  days_late: number;
}

export interface Receipt {
  id: number;
  receipt_no: string;
  /** The number printed on the paper voucher (legacy MYFNO); not unique. */
  ref_no: string | null;
  receipt_date: string;
  client_id: number;
  contract_id: number | null;
  cash_account_id: number;
  amount: Money;
  currency_id: number;
  exchange_rate: Money;
  method: PaymentMethod;
  cheque_no: string | null;
  journal_entry_id: number | null;
  notes: string | null;
  created_at: string;
}

export interface ReceiptDetail extends Receipt {
  client_name: string | null;
  client_code: string | null;
  contract_no: string | null;
  currency_code: string | null;
  currency_name: string | null;
  cash_account_name: string | null;
}

export interface Payment {
  id: number;
  payment_no: string;
  ref_no: string | null;
  payment_date: string;
  beneficiary_account_id: number;
  contract_id: number | null;
  cash_account_id: number;
  amount: Money;
  currency_id: number;
  exchange_rate: Money;
  method: PaymentMethod;
  cheque_no: string | null;
  journal_entry_id: number | null;
  notes: string | null;
  created_at: string;
}

export interface PaymentDetail extends Payment {
  beneficiary_name: string | null;
  currency_code: string | null;
  currency_name: string | null;
  cash_account_name: string | null;
}

export interface JournalEntry {
  id: number;
  entry_no: string;
  entry_date: string;
  entry_type: EntryType;
  description: string | null;
  contract_id: number | null;
  currency_id: number;
  exchange_rate: Money;
  is_posted: boolean;
  created_at: string;
}

export interface JournalLine {
  id: number;
  entry_id: number;
  account_id: number;
  client_id: number | null;
  debit: Money;
  credit: Money;
  debit_base: Money;
  credit_base: Money;
  line_desc: string | null;
  account_code: string | null;
  account_name: string | null;
}

export interface JournalEntryDetail extends JournalEntry {
  lines: JournalLine[];
  total_debit: Money;
  total_credit: Money;
}

export interface Kpis {
  total_buildings: number;
  total_units: number;
  units_sold: number;
  units_rented: number;
  units_available: number;
  total_clients: number;
  active_contracts: number;
  receivable_base: Money;
  collected_this_month: Money;
  overdue_base: Money;
}

export interface RecentDoc {
  entry_date: string;
  entry_no: string;
  entry_type: EntryType;
  description: string | null;
  amount_base: Money;
}

export interface CashBalance {
  account_id: number;
  code: string;
  name: string;
  balance: Money;
}

export interface DebtorRow {
  client_id: number;
  code: string | null;
  name: string;
  project: string | null;
  balance: Money;
}

export interface RecentReceipt {
  id: number;
  receipt_no: string;
  /** The number printed on the paper voucher (legacy MYFNO); not unique. */
  ref_no: string | null;
  receipt_date: string;
  client_id: number | null;
  client_name: string | null;
  amount_base: Money;
}

export interface Dashboard {
  kpis: Kpis;
  recent_docs: RecentDoc[];
  upcoming_dues: OverdueRow[];
  cash_accounts: CashBalance[];
  top_debtors: DebtorRow[];
  recent_receipts: RecentReceipt[];
  debtors_count: number;
  creditors_count: number;
}

/** كشف الأرصدة حسب عملة الحساب — mirrors schemas.reports.ClientBalancesReport. */
export interface ClientBalanceRow {
  client_id: number;
  code: string | null;
  name: string;
  currency: string | null;
  debit: Money;
  credit: Money;
  balance: Money;
  phone: string | null;
  project: string | null;
  block: string | null;
  floor_side: string | null;
}

export interface ClientBalancesReport {
  date_from: string | null;
  date_to: string | null;
  rows: ClientBalanceRow[];
  total_debit: Money;
  total_credit: Money;
  total_balance: Money;
}

export interface LedgerRow {
  entry_date: string;
  entry_no: string;
  entry_type: EntryType;
  line_desc: string | null;
  debit_base: Money;
  credit_base: Money;
  running_balance_base: Money;
}

export interface AccountLedger {
  account_id: number;
  account_code: string;
  account_name: string;
  date_from: string | null;
  date_to: string | null;
  opening_balance: Money;
  rows: LedgerRow[];
  closing_balance: Money;
}

export interface AvailabilityRow {
  building: string;
  unit_no: string;
  floor: number | null;
  unit_type: string;
  status: string;
  listed_price: Money | null;
  price_currency: string | null;
}

export interface SalesRow {
  entry_id: number;
  entry_date: string;
  entry_no: string;
  client_id: number | null;
  client_name: string | null;
  description: string | null;
  amount_base: Money;
}

export interface SalesReport {
  date_from: string | null;
  date_to: string | null;
  rows: SalesRow[];
  total_base: Money;
}

export interface MonthRow {
  month: string;
  sales_base: Money;
  received_base: Money;
  paid_base: Money;
  net_base: Money;
}

export interface MonthlyReport {
  date_from: string | null;
  date_to: string | null;
  rows: MonthRow[];
  sales_base: Money;
  received_base: Money;
  paid_base: Money;
  net_base: Money;
}

export interface OrgSettings {
  name: string;
  subtitle: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  tax_no: string | null;
  footer_note: string | null;
  /** `data:image/...;base64,...` — the letterhead logo, inline. */
  logo: string | null;
  updated_at: string;
}

/* ---------------------------------------------------------- collection */

/** One month of GET /api/reports/collection. "Owing" = owed at the start of
 *  the month (balance on its first day above the alert minimum); late =
 *  owing − paid. rate is 0–100, "0.00" when nobody owed. */
export interface CollectionMonth {
  period: string;
  owing_at_start: number;
  paid: number;
  late: number;
  rate: Money;
  /** Receipts dated in the month, all clients. */
  amount_collected: Money;
  /** Sum of the owing clients' monthly installments; null when none has one. */
  expected: Money | null;
}

export interface CollectionReport {
  as_of: string;
  current: CollectionMonth;
  /** Oldest → newest; the last one is `current`. */
  months: CollectionMonth[];
}

/* ---------------------------------------------------------- payment grid */

/** paid · short (below the installment) · unpaid (owed, paid nothing — red) ·
 *  settled (owed nothing) · before (before the first charge) · future. */
export type GridStatus = "paid" | "short" | "unpaid" | "settled" | "before" | "future";

export interface GridCell {
  period: string;
  paid: Money;
  receipts: number;
  status: GridStatus;
}

export interface GridRow {
  client_id: number;
  code: string | null;
  name: string;
  phone: string | null;
  project: string | null;
  block: string | null;
  balance: Money;
  monthly_installment: Money | null;
  first_charge_date: string | null;
  late: boolean;
  late_months: number;
  cells: GridCell[];
  total_paid: Money;
}

export interface GridTotal {
  period: string;
  paid_amount: Money;
  paid_clients: number;
  owing_clients: number;
  rate: Money;
}

/** GET /api/schedule/grid. Mirrors the backend's grid schema. */
export interface PaymentGrid {
  year: number;
  as_of: string;
  months: string[];
  /** Every project, for the filter (not only those on screen). */
  projects: string[];
  rows: GridRow[];
  totals: GridTotal[];
}

/* ---------------------------------------------------------- bulk */

/** One line of POST /api/receipts/bulk. */
export interface BulkReceiptLine {
  client_id: number;
  amount: string;
  contract_id?: number | null;
  ref_no?: string | null;
  cheque_no?: string | null;
  notes?: string | null;
}

/** POST /api/receipts/bulk — 200 even when some lines fail; `line` is the
 *  index into the request's lines. */
export interface BulkReceiptResult {
  created: { line: number; client_id: number; receipt_id: number; receipt_no: string; amount: Money }[];
  failures: { line: number; client_id: number; detail: string }[];
  count: number;
  total_amount: Money;
}

/** POST /api/alerts/remind/bulk. */
export interface BulkRemindResult {
  period: string;
  count: number;
  missing: number[];
}

/** GET /api/backups — one dated database backup in db_backup\. */
export interface BackupItem {
  name: string;
  /** The server PC's local time, no zone: "2026-09-28T03:30:15". */
  created_at: string;
  size_bytes: number;
  kind: "auto" | "manual";
}

export interface BackupStatus {
  folder: string;
  auto_enabled: boolean;
  every_hours: number;
  keep_days: number;
  keep_min: number;
  latest_at: string | null;
  next_due_at: string | null;
  last_auto_failure: { at: string; message: string } | null;
  total_bytes: number;
  items: BackupItem[];
}
