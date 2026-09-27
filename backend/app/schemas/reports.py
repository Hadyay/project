from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from app.models.base import EntryType
from app.schemas.contracts import OverdueRow


class KpiCard(BaseModel):
    total_buildings: int
    total_units: int
    units_sold: int
    units_rented: int
    units_available: int
    total_clients: int
    active_contracts: int
    receivable_base: Decimal      # what clients still owe, in base currency
    collected_this_month: Decimal
    overdue_base: Decimal


class RecentDoc(BaseModel):
    entry_date: date
    entry_no: str
    entry_type: EntryType
    description: str | None
    amount_base: Decimal


class CashBalance(BaseModel):
    """A till or bank account and what is in it, in base currency."""

    account_id: int
    code: str
    name: str
    balance: Decimal


class DebtorRow(BaseModel):
    client_id: int
    code: str | None
    name: str
    project: str | None
    balance: Decimal


class RecentReceipt(BaseModel):
    id: int
    receipt_no: str
    ref_no: str | None = None
    receipt_date: date
    client_id: int | None
    client_name: str | None
    amount_base: Decimal


class Dashboard(BaseModel):
    kpis: KpiCard
    recent_docs: list[RecentDoc]
    upcoming_dues: list[OverdueRow]
    # What an office wants the moment it opens the system: money on hand,
    # who owes the most, what came in last.
    cash_accounts: list[CashBalance] = []
    top_debtors: list[DebtorRow] = []
    recent_receipts: list[RecentReceipt] = []
    debtors_count: int = 0
    creditors_count: int = 0


class LedgerRow(BaseModel):
    """Account ledger (دفتر الأستاذ) row with a running balance."""

    entry_date: date
    entry_no: str
    entry_type: EntryType
    line_desc: str | None
    debit_base: Decimal
    credit_base: Decimal
    running_balance_base: Decimal


class AccountLedger(BaseModel):
    account_id: int
    account_code: str
    account_name: str
    date_from: date | None
    date_to: date | None
    opening_balance: Decimal
    rows: list[LedgerRow]
    closing_balance: Decimal


class AvailabilityRow(BaseModel):
    building: str
    unit_no: str
    floor: int | None
    unit_type: str
    status: str
    listed_price: Decimal | None
    price_currency: str | None


class SalesRow(BaseModel):
    """One sale document: what was sold, to whom, for how much."""

    entry_id: int
    entry_date: date
    entry_no: str
    client_id: int | None
    client_name: str | None
    description: str | None
    amount_base: Decimal


class SalesReport(BaseModel):
    date_from: date | None
    date_to: date | None
    rows: list[SalesRow]
    total_base: Decimal


class MonthRow(BaseModel):
    """One month of cash movement, straight off the ledger."""

    month: str            # YYYY-MM
    sales_base: Decimal
    received_base: Decimal
    paid_base: Decimal
    net_base: Decimal     # received - paid


class MonthlyReport(BaseModel):
    date_from: date | None
    date_to: date | None
    rows: list[MonthRow]
    sales_base: Decimal
    received_base: Decimal
    paid_base: Decimal
    net_base: Decimal


class ClientBalanceRow(BaseModel):
    """One line of كشف الأرصدة حسب عملة الحساب — the legacy balances report."""

    client_id: int
    code: str | None
    name: str
    currency: str | None
    debit: Decimal
    credit: Decimal
    balance: Decimal
    phone: str | None
    project: str | None
    block: str | None
    floor_side: str | None


class ClientBalancesReport(BaseModel):
    date_from: date | None
    date_to: date | None
    rows: list[ClientBalanceRow]
    total_debit: Decimal
    total_credit: Decimal
    total_balance: Decimal


# ---------------------------------------------------------------- collection & grid


class CollectionMonth(BaseModel):
    """Of the clients who owed at the start of the month, how many paid.
    Same rule as the reminders (app/services/collection.py)."""

    period: str
    owing_at_start: int
    paid: int
    late: int
    rate: Decimal  # 0–100; 0 when nobody owed at the start
    amount_collected: Decimal  # every receipt dated in the month
    expected: Decimal | None  # sum of owing clients' monthly installments, when any is set


class CollectionReport(BaseModel):
    as_of: date
    current: CollectionMonth
    months: list[CollectionMonth]  # oldest → newest, the last is `current`


class GridCell(BaseModel):
    period: str
    paid: Decimal
    receipts: int
    status: Literal["paid", "short", "unpaid", "before", "future", "settled"]


class GridRow(BaseModel):
    client_id: int
    code: str | None
    name: str
    phone: str | None
    project: str | None
    block: str | None
    balance: Decimal
    monthly_installment: Decimal | None
    first_charge_date: date | None
    late: bool
    late_months: int
    cells: list[GridCell]
    total_paid: Decimal


class GridTotal(BaseModel):
    period: str
    paid_amount: Decimal
    paid_clients: int
    owing_clients: int
    rate: Decimal


class PaymentGrid(BaseModel):
    year: int
    as_of: date
    months: list[str]
    projects: list[str]
    rows: list[GridRow]
    totals: list[GridTotal]
