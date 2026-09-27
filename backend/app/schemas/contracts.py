from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator

from app.models.base import ContractStatus, ContractType, ScheduleStatus
from app.schemas.common import ORMModel


class ContractBase(BaseModel):
    contract_no: str = Field(max_length=40)
    contract_type: ContractType
    client_id: int
    apartment_id: int
    currency_id: int
    status: ContractStatus = ContractStatus.draft
    sign_date: date | None = None
    start_date: date | None = None
    end_date: date | None = None

    # SALE
    total_amount: Decimal | None = Field(default=None, ge=0)
    down_payment: Decimal | None = Field(default=None, ge=0)
    installment_count: int | None = Field(default=None, ge=0, le=600)

    # RENT
    monthly_rent: Decimal | None = Field(default=None, ge=0)
    deposit: Decimal | None = Field(default=None, ge=0)
    billing_day: int | None = Field(default=None, ge=1, le=28)

    notes: str | None = None


class ContractCreate(ContractBase):
    # Build the installment / rent-period rows right after creating the contract.
    generate_schedule: bool = True

    @model_validator(mode="after")
    def _type_requirements(self) -> "ContractCreate":
        # Mirrors the sale_needs_total / rent_needs_rent CHECK constraints, but
        # fails at the API edge with a readable message instead of a DB error.
        if self.contract_type is ContractType.sale and self.total_amount is None:
            raise ValueError("total_amount is required for a sale contract")
        if self.contract_type is ContractType.rent and self.monthly_rent is None:
            raise ValueError("monthly_rent is required for a rent contract")
        if self.contract_type is ContractType.sale and self.down_payment is not None:
            if self.total_amount is not None and self.down_payment > self.total_amount:
                raise ValueError("down_payment cannot exceed total_amount")
        if self.generate_schedule:
            if self.start_date is None:
                raise ValueError("start_date is required to generate a payment schedule")
            if self.contract_type is ContractType.sale and not self.installment_count:
                raise ValueError("installment_count is required to generate a sale schedule")
            if self.contract_type is ContractType.rent and self.end_date is None:
                raise ValueError("end_date is required to generate a rent schedule")
        return self


class ContractUpdate(BaseModel):
    status: ContractStatus | None = None
    sign_date: date | None = None
    start_date: date | None = None
    end_date: date | None = None
    total_amount: Decimal | None = Field(default=None, ge=0)
    down_payment: Decimal | None = Field(default=None, ge=0)
    installment_count: int | None = Field(default=None, ge=0, le=600)
    monthly_rent: Decimal | None = Field(default=None, ge=0)
    deposit: Decimal | None = Field(default=None, ge=0)
    billing_day: int | None = Field(default=None, ge=1, le=28)
    notes: str | None = None


class ContractOut(ORMModel, ContractBase):
    id: int
    created_at: datetime
    updated_at: datetime


class ContractDetail(ContractOut):
    client_name: str | None = None
    building_name: str | None = None
    unit_no: str | None = None
    currency_code: str | None = None
    paid_total: Decimal = Decimal(0)
    outstanding_total: Decimal = Decimal(0)


class ScheduleRowOut(ORMModel):
    id: int
    contract_id: int
    seq_no: int
    due_date: date
    amount: Decimal
    currency_id: int
    paid_amount: Decimal
    status: ScheduleStatus


class ScheduleRowUpdate(BaseModel):
    due_date: date | None = None
    amount: Decimal | None = Field(default=None, ge=0)
    status: ScheduleStatus | None = None


class RentInvoiceFailure(BaseModel):
    contract_no: str
    seq_no: int
    detail: str


class RentInvoiceRun(BaseModel):
    """Result of invoicing every due rent period in one go."""

    as_of: date
    invoiced: int
    skipped: int  # periods that already had an invoice
    entry_nos: list[str]
    failures: list[RentInvoiceFailure]


class OverdueRefresh(BaseModel):
    as_of: date
    marked_overdue: int
    cleared: int


class OverdueRow(BaseModel):
    id: int
    contract_no: str
    contract_type: ContractType
    client_id: int
    client_name: str
    due_date: date
    amount: Decimal
    paid_amount: Decimal
    outstanding: Decimal
    days_late: int
