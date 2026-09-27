from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class AlertSettingsOut(ORMModel):
    enabled: bool
    alert_day: int
    min_balance: Decimal
    updated_at: datetime


class AlertSettingsUpdate(BaseModel):
    enabled: bool | None = None
    alert_day: int | None = Field(default=None, ge=1, le=28)
    min_balance: Decimal | None = Field(default=None, ge=0)


class LateClientOut(BaseModel):
    client_id: int
    code: str | None
    name: str
    phone: str | None
    project: str | None
    block: str | None
    floor_side: str | None
    balance: Decimal
    monthly_installment: Decimal | None
    paid_this_cycle: Decimal
    last_payment_date: date | None
    months_unpaid: int | None
    overdue_installments: int
    overdue_amount: Decimal
    reason: Literal["no_payment", "short", "overdue_installment"]
    reminded_at: datetime | None
    reminded_by: str | None
    reminder_note: str | None


class CycleOut(BaseModel):
    period: str
    start: date
    alert_date: date
    next_alert_date: date
    is_alert_day: bool


class AlertsReport(BaseModel):
    enabled: bool
    alert_day: int
    min_balance: Decimal
    as_of: date
    cycle: CycleOut
    count: int
    reminded_count: int
    total_balance: Decimal
    rows: list[LateClientOut]


class AlertsSummary(BaseModel):
    """What the bell in the top bar needs — no rows."""

    enabled: bool
    alert_day: int
    period: str
    alert_date: date
    is_alert_day: bool
    count: int
    reminded_count: int
    total_balance: Decimal


class ReminderMark(BaseModel):
    note: str | None = Field(default=None, max_length=500)
