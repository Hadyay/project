from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.base import PaymentMethod
from app.schemas.common import ORMModel


class ReceiptCreate(BaseModel):
    receipt_no: str | None = Field(default=None, max_length=40)  # auto-numbered when omitted
    ref_no: str | None = Field(default=None, max_length=30)  # the paper voucher's number, if any
    receipt_date: date
    client_id: int
    contract_id: int | None = None
    cash_account_id: int
    amount: Decimal = Field(gt=0)
    currency_id: int
    exchange_rate: Decimal | None = Field(default=None, gt=0)
    method: PaymentMethod = PaymentMethod.cash
    cheque_no: str | None = Field(default=None, max_length=40)
    notes: str | None = None
    # Post the GL entry (Dr cash / Cr client receivable) immediately.
    post: bool = True


class ReceiptOut(ORMModel):
    id: int
    receipt_no: str
    ref_no: str | None = None
    receipt_date: date
    client_id: int
    contract_id: int | None
    cash_account_id: int
    amount: Decimal
    currency_id: int
    exchange_rate: Decimal
    method: PaymentMethod
    cheque_no: str | None
    journal_entry_id: int | None
    notes: str | None
    created_at: datetime


class ReceiptDetail(ReceiptOut):
    client_name: str | None = None
    client_code: str | None = None
    contract_no: str | None = None
    currency_code: str | None = None
    currency_name: str | None = None
    cash_account_name: str | None = None


class CashDefaults(BaseModel):
    """What a new receipt or payment form starts with."""

    cash_account_id: int | None  # null when the configured till is missing or not a postable till
    currency_id: int  # the base currency


class BulkReceiptLine(BaseModel):
    client_id: int
    amount: Decimal = Field(gt=0)
    contract_id: int | None = None  # allocate against this contract's schedule
    ref_no: str | None = Field(default=None, max_length=30)
    cheque_no: str | None = Field(default=None, max_length=40)
    notes: str | None = None


class BulkReceiptCreate(BaseModel):
    """Many receipts on one date into one till — the end-of-day entry of a
    stack of paper vouchers. Everything but the client and amount is shared."""

    receipt_date: date
    cash_account_id: int
    currency_id: int
    exchange_rate: Decimal | None = Field(default=None, gt=0)
    method: PaymentMethod = PaymentMethod.cash
    post: bool = True
    lines: list[BulkReceiptLine] = Field(min_length=1, max_length=1000)


class BulkReceiptCreated(BaseModel):
    line: int  # index into the request's `lines`
    client_id: int
    receipt_id: int
    receipt_no: str
    amount: Decimal


class BulkReceiptFailure(BaseModel):
    line: int
    client_id: int
    detail: str


class BulkReceiptResult(BaseModel):
    created: list[BulkReceiptCreated]
    failures: list[BulkReceiptFailure]
    count: int
    total_amount: Decimal


class PaymentCreate(BaseModel):
    payment_no: str | None = Field(default=None, max_length=40)
    ref_no: str | None = Field(default=None, max_length=30)
    payment_date: date
    beneficiary_account_id: int
    contract_id: int | None = None
    cash_account_id: int
    amount: Decimal = Field(gt=0)
    currency_id: int
    exchange_rate: Decimal | None = Field(default=None, gt=0)
    method: PaymentMethod = PaymentMethod.cash
    cheque_no: str | None = Field(default=None, max_length=40)
    notes: str | None = None
    post: bool = True


class PaymentOut(ORMModel):
    id: int
    payment_no: str
    ref_no: str | None = None
    payment_date: date
    beneficiary_account_id: int
    contract_id: int | None
    cash_account_id: int
    amount: Decimal
    currency_id: int
    exchange_rate: Decimal
    method: PaymentMethod
    cheque_no: str | None
    journal_entry_id: int | None
    notes: str | None
    created_at: datetime


class PaymentDetail(PaymentOut):
    beneficiary_name: str | None = None
    currency_code: str | None = None
    currency_name: str | None = None
    cash_account_name: str | None = None
