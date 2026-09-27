from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator

from app.models.base import EntryType
from app.schemas.common import ORMModel


class JournalLineIn(BaseModel):
    account_id: int
    client_id: int | None = None
    debit: Decimal = Field(default=Decimal(0), ge=0)
    credit: Decimal = Field(default=Decimal(0), ge=0)
    line_desc: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def _one_sided(self) -> "JournalLineIn":
        if self.debit > 0 and self.credit > 0:
            raise ValueError("a journal line is either a debit or a credit, not both")
        if self.debit == 0 and self.credit == 0:
            raise ValueError("a journal line needs a non-zero debit or credit")
        return self


class JournalLineOut(ORMModel):
    id: int
    entry_id: int
    account_id: int
    client_id: int | None
    debit: Decimal
    credit: Decimal
    debit_base: Decimal
    credit_base: Decimal
    line_desc: str | None


class JournalLineDetail(JournalLineOut):
    account_code: str | None = None
    account_name: str | None = None


class JournalEntryCreate(BaseModel):
    entry_no: str | None = Field(default=None, max_length=40)  # auto-numbered when omitted
    entry_date: date
    entry_type: EntryType = EntryType.adjustment
    description: str | None = None
    contract_id: int | None = None
    currency_id: int
    exchange_rate: Decimal | None = Field(default=None, gt=0)  # looked up when omitted
    is_posted: bool = False
    lines: list[JournalLineIn] = Field(min_length=2)

    @model_validator(mode="after")
    def _balanced(self) -> "JournalEntryCreate":
        debit = sum(line.debit for line in self.lines)
        credit = sum(line.credit for line in self.lines)
        if debit != credit:
            raise ValueError(f"entry is not balanced: debit={debit} credit={credit}")
        return self


class JournalEntryOut(ORMModel):
    id: int
    entry_no: str
    entry_date: date
    entry_type: EntryType
    description: str | None
    contract_id: int | None
    currency_id: int
    exchange_rate: Decimal
    is_posted: bool
    created_at: datetime


class JournalEntryDetail(JournalEntryOut):
    lines: list[JournalLineDetail] = []
    total_debit: Decimal = Decimal(0)
    total_credit: Decimal = Decimal(0)
