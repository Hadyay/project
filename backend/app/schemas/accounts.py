from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.base import AccountType
from app.schemas.common import ORMModel


class AccountBase(BaseModel):
    code: str = Field(max_length=30)
    name_ar: str = Field(max_length=200)
    name_en: str | None = Field(default=None, max_length=200)
    parent_id: int | None = None
    account_type: AccountType
    is_client: bool = False
    is_cash_bank: bool = False
    is_postable: bool = True
    currency_id: int | None = None


class AccountCreate(AccountBase):
    pass


class AccountUpdate(BaseModel):
    name_ar: str | None = Field(default=None, max_length=200)
    name_en: str | None = Field(default=None, max_length=200)
    parent_id: int | None = None
    account_type: AccountType | None = None
    is_client: bool | None = None
    is_cash_bank: bool | None = None
    is_postable: bool | None = None
    currency_id: int | None = None


class AccountOut(ORMModel, AccountBase):
    id: int
    created_at: datetime


class AccountTreeNode(AccountOut):
    """Chart-of-accounts node with its children nested underneath."""

    children: list["AccountTreeNode"] = []


class TrialBalanceRow(BaseModel):
    account_id: int
    code: str
    name_ar: str
    total_debit: Decimal
    total_credit: Decimal
    balance: Decimal
