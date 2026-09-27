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
