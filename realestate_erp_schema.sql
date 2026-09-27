-- ============================================================================
--  Real Estate ERP — PostgreSQL schema
--  Stack: FastAPI + PostgreSQL + Next.js
--  Scope: buildings/apartments, clients, sale + rental contracts,
--         full double-entry general ledger, multi-currency (LL/USD/EUR),
--         receipts & payments, soft-delete + audit.
--  Notes: base (functional) currency = USD. Every money amount is stored in
--         its transaction currency AND converted to base for reporting.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid(), if you prefer uuid PKs

-- ------------------------------------------------------------------ ENUM types
CREATE TYPE user_role        AS ENUM ('admin','accountant','sales','viewer');
CREATE TYPE account_type     AS ENUM ('asset','liability','equity','revenue','expense');
CREATE TYPE apartment_type   AS ENUM ('apartment','shop','office','storage','land','other');
CREATE TYPE apartment_status AS ENUM ('available','reserved','sold','rented','unavailable');
CREATE TYPE contract_type    AS ENUM ('sale','rent');
CREATE TYPE contract_status  AS ENUM ('draft','active','completed','cancelled','terminated');
CREATE TYPE schedule_status  AS ENUM ('pending','partial','paid','overdue','cancelled');
CREATE TYPE entry_type       AS ENUM ('opening','sale','rent_invoice','receipt','payment','adjustment','transfer');
CREATE TYPE payment_method   AS ENUM ('cash','bank_transfer','cheque','card','other');

-- ------------------------------------------------------------- reusable pieces
-- Soft-delete + audit columns are repeated on business tables:
--   is_deleted, deleted_at, deleted_by, created_at, updated_at, created_by
-- A trigger keeps updated_at fresh; deletes are soft by convention (app-enforced),
-- and every change is mirrored into audit_log.

-- ============================================================ REFERENCE / CONFIG
CREATE TABLE currencies (
    id          smallserial PRIMARY KEY,
    code        varchar(3)  NOT NULL UNIQUE,          -- 'USD','LBP','EUR'
    name_ar     varchar(60) NOT NULL,                 -- 'دولار','ليرة','يورو'
    name_en     varchar(60) NOT NULL,
    symbol      varchar(8),
    is_base     boolean     NOT NULL DEFAULT false     -- exactly one row = true (USD)
);
CREATE UNIQUE INDEX one_base_currency ON currencies (is_base) WHERE is_base;

CREATE TABLE exchange_rates (
    id            bigserial PRIMARY KEY,
    currency_id   smallint  NOT NULL REFERENCES currencies(id),
    rate_date     date      NOT NULL,
    rate_to_base  numeric(20,6) NOT NULL,             -- 1 unit of currency = X base(USD)
    UNIQUE (currency_id, rate_date)
);

CREATE TABLE users (
    id            bigserial PRIMARY KEY,
    username      varchar(50)  NOT NULL UNIQUE,
    password_hash varchar(255) NOT NULL,
    full_name     varchar(120),
    role          user_role    NOT NULL DEFAULT 'viewer',
    is_active     boolean      NOT NULL DEFAULT true,
    created_at    timestamptz  NOT NULL DEFAULT now()
);

-- =========================================================== CHART OF ACCOUNTS
-- Mirrors old ACCOUNTMAP: hierarchical (parent_id ~ SMAIN), coded, Arabic-named.
CREATE TABLE accounts (
    id            bigserial PRIMARY KEY,
    code          varchar(30)  NOT NULL UNIQUE,        -- e.g. '41100006'
    name_ar       varchar(200) NOT NULL,
    name_en       varchar(200),
    parent_id     bigint       REFERENCES accounts(id),
    account_type  account_type NOT NULL,
    -- functional tag so the app knows special accounts:
    is_client     boolean      NOT NULL DEFAULT false, -- receivable sub-accounts (411…)
    is_cash_bank  boolean      NOT NULL DEFAULT false,
    is_postable   boolean      NOT NULL DEFAULT true,   -- leaf accounts only accept entries
    currency_id   smallint     REFERENCES currencies(id),  -- null = multi-currency
    created_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX idx_accounts_parent ON accounts(parent_id);
CREATE INDEX idx_accounts_client ON accounts(is_client) WHERE is_client;

-- ============================================================= REAL-ESTATE DOMAIN
CREATE TABLE buildings (
    id            bigserial PRIMARY KEY,
    code          varchar(30) UNIQUE,
    name          varchar(150) NOT NULL,
    address       varchar(255),
    city          varchar(80),
    floors_count  smallint,
    description   text,
    is_deleted    boolean NOT NULL DEFAULT false,
    deleted_at    timestamptz, deleted_by bigint REFERENCES users(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    created_by    bigint REFERENCES users(id)
);

CREATE TABLE apartments (
    id             bigserial PRIMARY KEY,
    building_id    bigint NOT NULL REFERENCES buildings(id),
    unit_no        varchar(30) NOT NULL,
    floor          smallint,
    area_m2        numeric(10,2),
    unit_type      apartment_type   NOT NULL DEFAULT 'apartment',
    status         apartment_status NOT NULL DEFAULT 'available',
    listed_price   numeric(18,2),
    price_currency_id smallint REFERENCES currencies(id),
    description    text,
    is_deleted     boolean NOT NULL DEFAULT false,
    deleted_at     timestamptz, deleted_by bigint REFERENCES users(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     bigint REFERENCES users(id),
    UNIQUE (building_id, unit_no)
);
CREATE INDEX idx_apartments_building ON apartments(building_id);
CREATE INDEX idx_apartments_status   ON apartments(status);

CREATE TABLE clients (
    id            bigserial PRIMARY KEY,
    code          varchar(30) UNIQUE,
    name_ar       varchar(200) NOT NULL,
    name_en       varchar(200),
    national_id   varchar(50),
    phone         varchar(40),
    phone2        varchar(40),
    email         varchar(120),
    address       varchar(255),
    notes         text,
    -- each client is backed by one receivable account in the GL (old-system model):
    account_id    bigint REFERENCES accounts(id),
    is_deleted    boolean NOT NULL DEFAULT false,
    deleted_at    timestamptz, deleted_by bigint REFERENCES users(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    created_by    bigint REFERENCES users(id)
);
CREATE INDEX idx_clients_account ON clients(account_id);
CREATE INDEX idx_clients_name    ON clients(name_ar);

-- =================================================================== CONTRACTS
-- One table for both sale and rental; type-specific fields are nullable.
CREATE TABLE contracts (
    id             bigserial PRIMARY KEY,
    contract_no    varchar(40) NOT NULL UNIQUE,
    contract_type  contract_type NOT NULL,
    client_id      bigint NOT NULL REFERENCES clients(id),
    apartment_id   bigint NOT NULL REFERENCES apartments(id),
    currency_id    smallint NOT NULL REFERENCES currencies(id),
    status         contract_status NOT NULL DEFAULT 'draft',
    sign_date      date,
    start_date     date,
    end_date       date,                 -- rent: lease end; sale: usually null
    -- SALE fields:
    total_amount   numeric(18,2),        -- full sale price
    down_payment   numeric(18,2),
    installment_count smallint,
    -- RENT fields:
    monthly_rent   numeric(18,2),
    deposit        numeric(18,2),
    billing_day    smallint,             -- day of month rent is invoiced
    notes          text,
    is_deleted     boolean NOT NULL DEFAULT false,
    deleted_at     timestamptz, deleted_by bigint REFERENCES users(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     bigint REFERENCES users(id),
    CONSTRAINT sale_needs_total  CHECK (contract_type <> 'sale' OR total_amount IS NOT NULL),
    CONSTRAINT rent_needs_rent   CHECK (contract_type <> 'rent' OR monthly_rent IS NOT NULL)
);
CREATE INDEX idx_contracts_client    ON contracts(client_id);
CREATE INDEX idx_contracts_apartment ON contracts(apartment_id);
CREATE INDEX idx_contracts_status    ON contracts(status);

-- Unified schedule: sale installments AND rent periods both live here.
CREATE TABLE payment_schedule (
    id            bigserial PRIMARY KEY,
    contract_id   bigint NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    seq_no        integer NOT NULL,
    due_date      date NOT NULL,
    amount        numeric(18,2) NOT NULL,
    currency_id   smallint NOT NULL REFERENCES currencies(id),
    paid_amount   numeric(18,2) NOT NULL DEFAULT 0,
    status        schedule_status NOT NULL DEFAULT 'pending',
    UNIQUE (contract_id, seq_no)
);
CREATE INDEX idx_schedule_contract ON payment_schedule(contract_id);
CREATE INDEX idx_schedule_due      ON payment_schedule(due_date) WHERE status <> 'paid';

-- ==================================================== GENERAL LEDGER (double-entry)
-- Document header. Mirrors old JOURNAL (typed سند/مبيع/قبض/صرف).
CREATE TABLE journal_entries (
    id             bigserial PRIMARY KEY,
    entry_no       varchar(40) NOT NULL UNIQUE,
    entry_date     date NOT NULL,
    entry_type     entry_type NOT NULL,
    description    text,
    -- optional link back to what generated this entry:
    contract_id    bigint REFERENCES contracts(id),
    currency_id    smallint NOT NULL REFERENCES currencies(id),
    exchange_rate  numeric(20,6) NOT NULL DEFAULT 1,   -- txn currency -> base
    is_posted      boolean NOT NULL DEFAULT false,
    is_deleted     boolean NOT NULL DEFAULT false,
    deleted_at     timestamptz, deleted_by bigint REFERENCES users(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     bigint REFERENCES users(id)
);
CREATE INDEX idx_entries_date     ON journal_entries(entry_date);
CREATE INDEX idx_entries_type     ON journal_entries(entry_type);
CREATE INDEX idx_entries_contract ON journal_entries(contract_id);

-- Ledger lines. Mirrors old SACCOUNT: debit/credit in txn + base currency.
CREATE TABLE journal_lines (
    id             bigserial PRIMARY KEY,
    entry_id       bigint NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id     bigint NOT NULL REFERENCES accounts(id),
    client_id      bigint REFERENCES clients(id),      -- analytics: which client this hits
    debit          numeric(18,2) NOT NULL DEFAULT 0,   -- transaction currency
    credit         numeric(18,2) NOT NULL DEFAULT 0,
    debit_base     numeric(18,2) NOT NULL DEFAULT 0,   -- converted to base (USD)
    credit_base    numeric(18,2) NOT NULL DEFAULT 0,
    line_desc      varchar(255),
    CONSTRAINT one_sided CHECK (debit = 0 OR credit = 0)  -- a line is debit XOR credit
);
CREATE INDEX idx_lines_entry   ON journal_lines(entry_id);
CREATE INDEX idx_lines_account ON journal_lines(account_id);
CREATE INDEX idx_lines_client  ON journal_lines(client_id);

-- ===================================================== CASH: receipts & payments
-- Receipts (قبض) — money IN, always linked to a client. Mirrors old RECEIPT.
CREATE TABLE receipts (
    id             bigserial PRIMARY KEY,
    receipt_no     varchar(40) NOT NULL UNIQUE,
    receipt_date   date NOT NULL,
    client_id      bigint NOT NULL REFERENCES clients(id),
    contract_id    bigint REFERENCES contracts(id),           -- what it's paying toward
    cash_account_id bigint NOT NULL REFERENCES accounts(id),  -- cash/bank received into
    amount         numeric(18,2) NOT NULL,
    currency_id    smallint NOT NULL REFERENCES currencies(id),
    exchange_rate  numeric(20,6) NOT NULL DEFAULT 1,
    method         payment_method NOT NULL DEFAULT 'cash',
    cheque_no      varchar(40),
    journal_entry_id bigint REFERENCES journal_entries(id),   -- GL posting
    notes          text,
    is_deleted     boolean NOT NULL DEFAULT false,
    deleted_at     timestamptz, deleted_by bigint REFERENCES users(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     bigint REFERENCES users(id)
);
CREATE INDEX idx_receipts_client   ON receipts(client_id);
CREATE INDEX idx_receipts_contract ON receipts(contract_id);
CREATE INDEX idx_receipts_date     ON receipts(receipt_date);

-- Payments (صرف) — money OUT. Mirrors old PAYMENT.
CREATE TABLE payments (
    id             bigserial PRIMARY KEY,
    payment_no     varchar(40) NOT NULL UNIQUE,
    payment_date   date NOT NULL,
    beneficiary_account_id bigint NOT NULL REFERENCES accounts(id),
    contract_id    bigint REFERENCES contracts(id),
    cash_account_id bigint NOT NULL REFERENCES accounts(id),   -- cash/bank paid from
    amount         numeric(18,2) NOT NULL,
    currency_id    smallint NOT NULL REFERENCES currencies(id),
    exchange_rate  numeric(20,6) NOT NULL DEFAULT 1,
    method         payment_method NOT NULL DEFAULT 'cash',
    cheque_no      varchar(40),
    journal_entry_id bigint REFERENCES journal_entries(id),
    notes          text,
    is_deleted     boolean NOT NULL DEFAULT false,
    deleted_at     timestamptz, deleted_by bigint REFERENCES users(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     bigint REFERENCES users(id)
);
CREATE INDEX idx_payments_date ON payments(payment_date);

-- ================================================================== AUDIT TRAIL
-- Every insert/update/delete on business tables is mirrored here (app- or trigger-fed).
CREATE TABLE audit_log (
    id          bigserial PRIMARY KEY,
    table_name  varchar(60) NOT NULL,
    record_id   bigint NOT NULL,
    action      varchar(10) NOT NULL,          -- insert / update / delete
    changed_by  bigint REFERENCES users(id),
    changed_at  timestamptz NOT NULL DEFAULT now(),
    old_values  jsonb,
    new_values  jsonb
);
CREATE INDEX idx_audit_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_when   ON audit_log(changed_at);

-- ================================================================== TRIGGERS
-- keep updated_at fresh
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_buildings_touch  BEFORE UPDATE ON buildings  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_apartments_touch BEFORE UPDATE ON apartments FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_clients_touch    BEFORE UPDATE ON clients    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_contracts_touch  BEFORE UPDATE ON contracts  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- enforce that a posted journal entry is balanced (sum debit_base = sum credit_base)
CREATE OR REPLACE FUNCTION check_entry_balanced() RETURNS trigger AS $$
DECLARE d numeric(18,2); c numeric(18,2);
BEGIN
    SELECT COALESCE(sum(debit_base),0), COALESCE(sum(credit_base),0)
      INTO d, c FROM journal_lines WHERE entry_id = NEW.id;
    IF NEW.is_posted AND d <> c THEN
        RAISE EXCEPTION 'Journal entry % is not balanced: debit=% credit=%', NEW.entry_no, d, c;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_entry_balanced
    AFTER INSERT OR UPDATE ON journal_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();

-- ==================================================================== VIEWS
-- Client statement (كشف حساب): every ledger line hitting the client's account,
-- with a running balance in base currency. Drives the printable statement.
CREATE VIEW v_client_statement AS
SELECT
    cl.id                        AS client_id,
    cl.name_ar                   AS client_name,
    je.entry_date,
    je.entry_no,
    je.entry_type,
    jl.line_desc,
    jl.debit_base,
    jl.credit_base,
    sum(jl.debit_base - jl.credit_base) OVER (
        PARTITION BY cl.id ORDER BY je.entry_date, je.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )                            AS running_balance_base
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.entry_id AND NOT je.is_deleted
JOIN clients cl         ON cl.account_id = jl.account_id
WHERE NOT cl.is_deleted;

-- Trial balance (ميزان): net debit/credit per account in base currency.
-- Which lines count is settled inside the subquery, with an inner join: a
-- LEFT JOIN … AND NOT je.is_deleted does not drop the line, it only nulls the
-- entry columns, so a voided entry's amounts would still reach the totals.
-- The join back to accounts stays outer, so an account that never moved is
-- still listed at zero.
CREATE VIEW v_trial_balance AS
SELECT
    a.id AS account_id, a.code, a.name_ar,
    COALESCE(sum(m.debit_base),0)  AS total_debit,
    COALESCE(sum(m.credit_base),0) AS total_credit,
    COALESCE(sum(m.debit_base - m.credit_base),0) AS balance
FROM accounts a
LEFT JOIN (
    SELECT jl.account_id, jl.debit_base, jl.credit_base
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    WHERE NOT je.is_deleted
) m ON m.account_id = a.id
GROUP BY a.id, a.code, a.name_ar;

-- Overdue installments / rent: what each client owes and is late on.
CREATE VIEW v_overdue_schedule AS
SELECT
    ps.id, c.contract_no, c.contract_type,
    cl.id AS client_id, cl.name_ar AS client_name,
    ps.due_date, ps.amount, ps.paid_amount,
    (ps.amount - ps.paid_amount) AS outstanding,
    (CURRENT_DATE - ps.due_date) AS days_late
FROM payment_schedule ps
JOIN contracts c ON c.id = ps.contract_id AND NOT c.is_deleted
JOIN clients  cl ON cl.id = c.client_id
WHERE ps.status IN ('pending','partial','overdue')
  AND ps.due_date < CURRENT_DATE;

-- Apartment availability board.
CREATE VIEW v_apartment_availability AS
SELECT b.name AS building, a.unit_no, a.floor, a.unit_type,
       a.status, a.listed_price, cur.code AS price_currency
FROM apartments a
JOIN buildings b   ON b.id = a.building_id AND NOT b.is_deleted
LEFT JOIN currencies cur ON cur.id = a.price_currency_id
WHERE NOT a.is_deleted;

-- ============================================================ SEED (starter rows)
INSERT INTO currencies (code, name_ar, name_en, symbol, is_base) VALUES
    ('USD','دولار','US Dollar','$', true),
    ('LBP','ليرة','Lebanese Pound','ل.ل', false),
    ('EUR','يورو','Euro','€', false);
