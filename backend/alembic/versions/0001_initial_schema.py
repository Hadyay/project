"""Initial schema: reference data, real-estate domain, contracts, GL, cash, audit.

Mirrors realestate_erp_schema.sql — including the native enum types, the
updated_at/balance triggers and the reporting views, which autogenerate cannot
see and would otherwise be dropped on the next migration.

Revision ID: 0001
Revises:
Create Date: 2026-09-10

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ENUMS: dict[str, tuple[str, ...]] = {
    "user_role": ("admin", "accountant", "sales", "viewer"),
    "account_type": ("asset", "liability", "equity", "revenue", "expense"),
    "apartment_type": ("apartment", "shop", "office", "storage", "land", "other"),
    "apartment_status": ("available", "reserved", "sold", "rented", "unavailable"),
    "contract_type": ("sale", "rent"),
    "contract_status": ("draft", "active", "completed", "cancelled", "terminated"),
    "schedule_status": ("pending", "partial", "paid", "overdue", "cancelled"),
    "entry_type": ("opening", "sale", "rent_invoice", "receipt", "payment", "adjustment", "transfer"),
    "payment_method": ("cash", "bank_transfer", "cheque", "card", "other"),
}


def _enum(name: str) -> postgresql.ENUM:
    """Reference an already-created native enum without re-emitting CREATE TYPE."""
    return postgresql.ENUM(*ENUMS[name], name=name, create_type=False)


def _audit_columns() -> list[sa.Column]:
    return [
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", postgresql.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
    ]


VIEWS = ("v_apartment_availability", "v_overdue_schedule", "v_trial_balance", "v_client_statement")


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    for name, labels in ENUMS.items():
        values = ", ".join(f"'{label}'" for label in labels)
        op.execute(f"CREATE TYPE {name} AS ENUM ({values})")

    # ------------------------------------------------------ reference / config
    op.create_table(
        "currencies",
        sa.Column("id", sa.SmallInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("code", sa.String(3), nullable=False, unique=True),
        sa.Column("name_ar", sa.String(60), nullable=False),
        sa.Column("name_en", sa.String(60), nullable=False),
        sa.Column("symbol", sa.String(8), nullable=True),
        sa.Column("is_base", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("one_base_currency", "currencies", ["is_base"], unique=True, postgresql_where=sa.text("is_base"))

    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("username", sa.String(50), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(120), nullable=True),
        sa.Column("role", _enum("user_role"), nullable=False, server_default="viewer"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
    )

    op.create_table(
        "exchange_rates",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("currency_id", sa.SmallInteger(), sa.ForeignKey("currencies.id"), nullable=False),
        sa.Column("rate_date", sa.Date(), nullable=False),
        sa.Column("rate_to_base", sa.Numeric(20, 6), nullable=False),
    )
    op.create_index(
        "uq_exchange_rates_currency_date", "exchange_rates", ["currency_id", "rate_date"], unique=True
    )

    # ------------------------------------------------------ chart of accounts
    op.create_table(
        "accounts",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("code", sa.String(30), nullable=False, unique=True),
        sa.Column("name_ar", sa.String(200), nullable=False),
        sa.Column("name_en", sa.String(200), nullable=True),
        sa.Column("parent_id", sa.BigInteger(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("account_type", _enum("account_type"), nullable=False),
        sa.Column("is_client", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_cash_bank", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_postable", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("currency_id", sa.SmallInteger(), sa.ForeignKey("currencies.id"), nullable=True),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
    )
    op.create_index("idx_accounts_parent", "accounts", ["parent_id"])
    op.create_index("idx_accounts_client", "accounts", ["is_client"], postgresql_where=sa.text("is_client"))

    # ------------------------------------------------------ real-estate domain
    op.create_table(
        "buildings",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("code", sa.String(30), nullable=True, unique=True),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("address", sa.String(255), nullable=True),
        sa.Column("city", sa.String(80), nullable=True),
        sa.Column("floors_count", sa.SmallInteger(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        *_audit_columns(),
    )

    op.create_table(
        "apartments",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("building_id", sa.BigInteger(), sa.ForeignKey("buildings.id"), nullable=False),
        sa.Column("unit_no", sa.String(30), nullable=False),
        sa.Column("floor", sa.SmallInteger(), nullable=True),
        sa.Column("area_m2", sa.Numeric(10, 2), nullable=True),
        sa.Column("unit_type", _enum("apartment_type"), nullable=False, server_default="apartment"),
        sa.Column("status", _enum("apartment_status"), nullable=False, server_default="available"),
        sa.Column("listed_price", sa.Numeric(18, 2), nullable=True),
        sa.Column("price_currency_id", sa.SmallInteger(), sa.ForeignKey("currencies.id"), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        *_audit_columns(),
        sa.UniqueConstraint("building_id", "unit_no"),
    )
    op.create_index("idx_apartments_building", "apartments", ["building_id"])
    op.create_index("idx_apartments_status", "apartments", ["status"])

    op.create_table(
        "clients",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("code", sa.String(30), nullable=True, unique=True),
        sa.Column("name_ar", sa.String(200), nullable=False),
        sa.Column("name_en", sa.String(200), nullable=True),
        sa.Column("national_id", sa.String(50), nullable=True),
        sa.Column("phone", sa.String(40), nullable=True),
        sa.Column("phone2", sa.String(40), nullable=True),
        sa.Column("email", sa.String(120), nullable=True),
        sa.Column("address", sa.String(255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("account_id", sa.BigInteger(), sa.ForeignKey("accounts.id"), nullable=True),
        *_audit_columns(),
    )
    op.create_index("idx_clients_account", "clients", ["account_id"])
    op.create_index("idx_clients_name", "clients", ["name_ar"])

    # ------------------------------------------------------------- contracts
    op.create_table(
        "contracts",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("contract_no", sa.String(40), nullable=False, unique=True),
        sa.Column("contract_type", _enum("contract_type"), nullable=False),
        sa.Column("client_id", sa.BigInteger(), sa.ForeignKey("clients.id"), nullable=False),
        sa.Column("apartment_id", sa.BigInteger(), sa.ForeignKey("apartments.id"), nullable=False),
        sa.Column("currency_id", sa.SmallInteger(), sa.ForeignKey("currencies.id"), nullable=False),
        sa.Column("status", _enum("contract_status"), nullable=False, server_default="draft"),
        sa.Column("sign_date", sa.Date(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("total_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("down_payment", sa.Numeric(18, 2), nullable=True),
        sa.Column("installment_count", sa.SmallInteger(), nullable=True),
        sa.Column("monthly_rent", sa.Numeric(18, 2), nullable=True),
        sa.Column("deposit", sa.Numeric(18, 2), nullable=True),
        sa.Column("billing_day", sa.SmallInteger(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        *_audit_columns(),
        sa.CheckConstraint("contract_type <> 'sale' OR total_amount IS NOT NULL", name="sale_needs_total"),
        sa.CheckConstraint("contract_type <> 'rent' OR monthly_rent IS NOT NULL", name="rent_needs_rent"),
    )
    op.create_index("idx_contracts_client", "contracts", ["client_id"])
    op.create_index("idx_contracts_apartment", "contracts", ["apartment_id"])
    op.create_index("idx_contracts_status", "contracts", ["status"])

    op.create_table(
        "payment_schedule",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column(
            "contract_id", sa.BigInteger(), sa.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("seq_no", sa.Integer(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("currency_id", sa.SmallInteger(), sa.ForeignKey("currencies.id"), nullable=False),
        sa.Column("paid_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("status", _enum("schedule_status"), nullable=False, server_default="pending"),
        sa.UniqueConstraint("contract_id", "seq_no"),
    )
    op.create_index("idx_schedule_contract", "payment_schedule", ["contract_id"])
    op.create_index(
        "idx_schedule_due", "payment_schedule", ["due_date"], postgresql_where=sa.text("status <> 'paid'")
    )

    # ------------------------------------------------------- general ledger
    op.create_table(
        "journal_entries",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("entry_no", sa.String(40), nullable=False, unique=True),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("entry_type", _enum("entry_type"), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("contract_id", sa.BigInteger(), sa.ForeignKey("contracts.id"), nullable=True),
        sa.Column("currency_id", sa.SmallInteger(), sa.ForeignKey("currencies.id"), nullable=False),
        sa.Column("exchange_rate", sa.Numeric(20, 6), nullable=False, server_default="1"),
        sa.Column("is_posted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("idx_entries_date", "journal_entries", ["entry_date"])
    op.create_index("idx_entries_type", "journal_entries", ["entry_type"])
    op.create_index("idx_entries_contract", "journal_entries", ["contract_id"])

    op.create_table(
        "journal_lines",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column(
            "entry_id", sa.BigInteger(), sa.ForeignKey("journal_entries.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("account_id", sa.BigInteger(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("client_id", sa.BigInteger(), sa.ForeignKey("clients.id"), nullable=True),
        sa.Column("debit", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("credit", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("debit_base", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("credit_base", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("line_desc", sa.String(255), nullable=True),
        sa.CheckConstraint("debit = 0 OR credit = 0", name="one_sided"),
    )
    op.create_index("idx_lines_entry", "journal_lines", ["entry_id"])
    op.create_index("idx_lines_account", "journal_lines", ["account_id"])
    op.create_index("idx_lines_client", "journal_lines", ["client_id"])

    # ------------------------------------------------------ receipts/payments
    op.create_table(
        "receipts",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("receipt_no", sa.String(40), nullable=False, unique=True),
        sa.Column("receipt_date", sa.Date(), nullable=False),
        sa.Column("client_id", sa.BigInteger(), sa.ForeignKey("clients.id"), nullable=False),
        sa.Column("contract_id", sa.BigInteger(), sa.ForeignKey("contracts.id"), nullable=True),
        sa.Column("cash_account_id", sa.BigInteger(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("currency_id", sa.SmallInteger(), sa.ForeignKey("currencies.id"), nullable=False),
        sa.Column("exchange_rate", sa.Numeric(20, 6), nullable=False, server_default="1"),
        sa.Column("method", _enum("payment_method"), nullable=False, server_default="cash"),
        sa.Column("cheque_no", sa.String(40), nullable=True),
        sa.Column("journal_entry_id", sa.BigInteger(), sa.ForeignKey("journal_entries.id"), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("idx_receipts_client", "receipts", ["client_id"])
    op.create_index("idx_receipts_contract", "receipts", ["contract_id"])
    op.create_index("idx_receipts_date", "receipts", ["receipt_date"])

    op.create_table(
        "payments",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("payment_no", sa.String(40), nullable=False, unique=True),
        sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column("beneficiary_account_id", sa.BigInteger(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("contract_id", sa.BigInteger(), sa.ForeignKey("contracts.id"), nullable=True),
        sa.Column("cash_account_id", sa.BigInteger(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("currency_id", sa.SmallInteger(), sa.ForeignKey("currencies.id"), nullable=False),
        sa.Column("exchange_rate", sa.Numeric(20, 6), nullable=False, server_default="1"),
        sa.Column("method", _enum("payment_method"), nullable=False, server_default="cash"),
        sa.Column("cheque_no", sa.String(40), nullable=True),
        sa.Column("journal_entry_id", sa.BigInteger(), sa.ForeignKey("journal_entries.id"), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("idx_payments_date", "payments", ["payment_date"])

    # ------------------------------------------------------------ audit trail
    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("table_name", sa.String(60), nullable=False),
        sa.Column("record_id", sa.BigInteger(), nullable=False),
        sa.Column("action", sa.String(10), nullable=False),
        sa.Column("changed_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "changed_at", postgresql.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column("old_values", postgresql.JSONB(), nullable=True),
        sa.Column("new_values", postgresql.JSONB(), nullable=True),
    )
    op.create_index("idx_audit_record", "audit_log", ["table_name", "record_id"])
    op.create_index("idx_audit_when", "audit_log", ["changed_at"])

    _create_triggers()
    _create_views()


def _create_triggers() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
        BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;
        """
    )
    for table in ("buildings", "apartments", "clients", "contracts"):
        op.execute(
            f"CREATE TRIGGER trg_{table}_touch BEFORE UPDATE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION touch_updated_at()"
        )

    # A posted entry must balance in base currency. Deferred so the header can
    # be inserted before its lines within the same transaction.
    op.execute(
        """
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
        """
    )
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER trg_entry_balanced
            AFTER INSERT OR UPDATE ON journal_entries
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();
        """
    )


def _create_views() -> None:
    op.execute(
        """
        CREATE VIEW v_client_statement AS
        SELECT
            cl.id AS client_id, cl.name_ar AS client_name,
            je.entry_date, je.entry_no, je.entry_type, jl.line_desc,
            jl.debit_base, jl.credit_base,
            sum(jl.debit_base - jl.credit_base) OVER (
                PARTITION BY cl.id ORDER BY je.entry_date, je.id
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS running_balance_base
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id AND NOT je.is_deleted
        JOIN clients cl         ON cl.account_id = jl.account_id
        WHERE NOT cl.is_deleted;
        """
    )
    op.execute(
        """
        CREATE VIEW v_trial_balance AS
        SELECT
            a.id AS account_id, a.code, a.name_ar,
            COALESCE(sum(jl.debit_base),0)  AS total_debit,
            COALESCE(sum(jl.credit_base),0) AS total_credit,
            COALESCE(sum(jl.debit_base - jl.credit_base),0) AS balance
        FROM accounts a
        LEFT JOIN journal_lines jl   ON jl.account_id = a.id
        LEFT JOIN journal_entries je ON je.id = jl.entry_id AND NOT je.is_deleted
        GROUP BY a.id, a.code, a.name_ar;
        """
    )
    op.execute(
        """
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
        """
    )
    op.execute(
        """
        CREATE VIEW v_apartment_availability AS
        SELECT b.name AS building, a.unit_no, a.floor, a.unit_type,
               a.status, a.listed_price, cur.code AS price_currency
        FROM apartments a
        JOIN buildings b   ON b.id = a.building_id AND NOT b.is_deleted
        LEFT JOIN currencies cur ON cur.id = a.price_currency_id
        WHERE NOT a.is_deleted;
        """
    )


def downgrade() -> None:
    for view in VIEWS:
        op.execute(f"DROP VIEW IF EXISTS {view}")

    op.execute("DROP TRIGGER IF EXISTS trg_entry_balanced ON journal_entries")
    op.execute("DROP FUNCTION IF EXISTS check_entry_balanced()")
    for table in ("buildings", "apartments", "clients", "contracts"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_touch ON {table}")
    op.execute("DROP FUNCTION IF EXISTS touch_updated_at()")

    for table in (
        "audit_log",
        "payments",
        "receipts",
        "journal_lines",
        "journal_entries",
        "payment_schedule",
        "contracts",
        "clients",
        "apartments",
        "buildings",
        "accounts",
        "exchange_rates",
        "users",
        "currencies",
    ):
        op.drop_table(table)

    for name in ENUMS:
        op.execute(f"DROP TYPE IF EXISTS {name}")
