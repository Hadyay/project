from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field

from app.models.base import EntryType
from app.schemas.common import ORMModel


class ClientBase(BaseModel):
    code: str | None = Field(default=None, max_length=30)
    name_ar: str = Field(max_length=200)
    name_en: str | None = Field(default=None, max_length=200)
    national_id: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=40)
    phone2: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=255)
    project: str | None = Field(default=None, max_length=100)
    block: str | None = Field(default=None, max_length=40)
    floor_side: str | None = Field(default=None, max_length=60)
    monthly_installment: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None


class ClientCreate(ClientBase):
    account_id: int | None = None
    # When true and no account_id is given, a receivable sub-account is created
    # under `receivable_parent_code` and linked to the new client.
    create_account: bool = True


class ClientUpdate(BaseModel):
    code: str | None = Field(default=None, max_length=30)
    name_ar: str | None = Field(default=None, max_length=200)
    name_en: str | None = Field(default=None, max_length=200)
    national_id: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=40)
    phone2: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=255)
    project: str | None = Field(default=None, max_length=100)
    block: str | None = Field(default=None, max_length=40)
    floor_side: str | None = Field(default=None, max_length=60)
    monthly_installment: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None
    account_id: int | None = None


class ClientOut(ORMModel, ClientBase):
    id: int
    account_id: int | None
    created_at: datetime
    updated_at: datetime


class ClientListItem(ClientOut):
    """A row of العملاء: the client plus its receivable balance in base
    currency — positive when the client owes, negative when paid ahead."""

    balance_base: Decimal = Decimal(0)
    # The monthly reminder (app/services/reminders.py): late in the cycle in
    # force today, and whole months since the last receipt (None = never paid).
    late: bool = False
    months_unpaid: int | None = None


class ClientBalance(BaseModel):
    client_id: int
    total_debit: Decimal
    total_credit: Decimal
    balance: Decimal
    entry_count: int
    last_payment_date: date | None


class StatementLine(BaseModel):
    """One row of كشف حساب — a ledger line hitting the client's account."""

    entry_id: int
    entry_date: date
    entry_no: str
    entry_type: EntryType
    line_desc: str | None
    # The other side of the same entry, and the voucher that raised it: what
    # the client actually asks about when a row does not look familiar.
    counterpart: str | None = None
    document_no: str | None = None
    currency_code: str | None = None
    debit: Decimal = Decimal(0)
    credit: Decimal = Decimal(0)
    debit_base: Decimal
    credit_base: Decimal
    running_balance_base: Decimal


class ClientStatement(BaseModel):
    client: ClientOut
    opening_balance: Decimal
    lines: list[StatementLine]
    closing_balance: Decimal
