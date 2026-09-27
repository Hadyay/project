"""Monthly payment reminders — who has not paid, computed live from the ledger.

The office sets one day of the month (alert_settings.alert_day, 1–28). Each
month is a *cycle* that opens on that day and runs until the next month's
alert day; the cycle in force on `as_of` is the one whose alert day has come.

A client is **late** in a cycle when (see app/services/collection.py, which
the dashboard ring and جدول الدفعات share, so the three never disagree):

  - they already owed at the start of the cycle's month — more than the
    configured minimum — and still owe today;
  - and since the start of that month they have paid nothing, or less than
    their monthly installment when one is set on the client;
  - or an installment on an active contract is past due and unpaid.

A client who first owes during a month is not late that month. On the alert
day every client who owed and has not paid turns red and stays red until a
receipt covers the month — recording the receipt is what clears the alert.
Before the alert day the previous month's cycle is still in force, and a
payment made in those first days still counts toward it.

`months_unpaid` counts whole months since the last receipt (0 = paid this
month, but short of the installment); None means the client never paid.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ClientReminder, User
from app.services.collection import (
    CENT,
    Snapshot,
    Window,
    overdue_installments,
    settings_row,
)

__all__ = ["settings_row", "cycle_for", "compute", "months_between", "Cycle", "LateClient", "ReminderReport"]


def _month_start(day: date) -> date:
    return day.replace(day=1)


def _previous_month_start(day: date) -> date:
    first = _month_start(day)
    return first.replace(year=first.year - 1, month=12) if first.month == 1 else first.replace(month=first.month - 1)


def months_between(earlier: date, later: date) -> int:
    return (later.year - earlier.year) * 12 + (later.month - earlier.month)


@dataclass
class Cycle:
    period: str            # "YYYY-MM" — the month being checked
    start: date            # first day of that month
    alert_date: date       # the day the alert for that month opened
    next_alert_date: date  # when the next cycle opens
    is_alert_day: bool     # as_of is exactly an alert day (the "alarm")


def cycle_for(as_of: date, alert_day: int) -> Cycle:
    this_alert = as_of.replace(day=alert_day)
    if as_of >= this_alert:
        start = _month_start(as_of)
        nxt = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
        return Cycle(start.strftime("%Y-%m"), start, this_alert, nxt.replace(day=alert_day), as_of == this_alert)
    start = _previous_month_start(as_of)
    return Cycle(start.strftime("%Y-%m"), start, start.replace(day=alert_day), this_alert, False)


@dataclass
class LateClient:
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
    reason: str                       # "no_payment" | "short" | "overdue_installment"
    reminded_at: object | None = None
    reminded_by: str | None = None
    reminder_note: str | None = None


@dataclass
class ReminderReport:
    enabled: bool
    alert_day: int
    min_balance: Decimal
    as_of: date
    cycle: Cycle
    rows: list[LateClient] = field(default_factory=list)

    @property
    def total_balance(self) -> Decimal:
        return sum((r.balance for r in self.rows), Decimal(0))

    @property
    def reminded_count(self) -> int:
        return sum(1 for r in self.rows if r.reminded_at is not None)


def compute(db: Session, as_of: date | None = None, client_id: int | None = None) -> ReminderReport:
    as_of = as_of or date.today()
    settings = settings_row(db)
    cycle = cycle_for(as_of, settings.alert_day)
    report = ReminderReport(settings.enabled, settings.alert_day, Decimal(settings.min_balance), as_of, cycle)
    if not settings.enabled:
        return report

    snap = Snapshot(db, as_of, [client_id] if client_id is not None else None)
    # The cycle's month, with payments counted up to as_of (a payment made on
    # the 1st or 2nd before the alert day still counts toward last month).
    window = Window(cycle.period, cycle.start, as_of)
    ids = [c.id for c in snap.clients]
    overdue = overdue_installments(db, as_of, ids)
    reminders = {
        rem.client_id: (rem, username)
        for rem, username in db.execute(
            select(ClientReminder, User.username)
            .outerjoin(User, User.id == ClientReminder.reminded_by)
            .where(ClientReminder.period == cycle.period, ClientReminder.client_id.in_(ids))
        ).all()
    }

    for client in snap.clients:
        cm = snap.month(client, window)
        now = snap.balance_through(client.id, as_of)
        if not cm.owing or now <= 0:
            continue
        n_overdue, overdue_amount = overdue.get(client.id, (0, Decimal(0)))
        if cm.late:
            reason = "short" if cm.status == "short" else "no_payment"
        elif n_overdue:
            reason = "overdue_installment"
        else:
            continue
        last_date = snap.last_receipt(client.id, as_of)
        rem = reminders.get(client.id)
        report.rows.append(
            LateClient(
                client_id=client.id,
                code=client.code,
                name=client.name_ar,
                phone=client.phone,
                project=client.project,
                block=client.block,
                floor_side=client.floor_side,
                balance=now.quantize(CENT),
                monthly_installment=Decimal(client.monthly_installment) if client.monthly_installment else None,
                paid_this_cycle=cm.paid.quantize(CENT),
                last_payment_date=last_date,
                months_unpaid=months_between(last_date, as_of) if last_date else None,
                overdue_installments=n_overdue,
                overdue_amount=overdue_amount,
                reason=reason,
                reminded_at=rem[0].reminded_at if rem else None,
                reminded_by=rem[1] if rem else None,
                reminder_note=rem[0].note if rem else None,
            )
        )

    # Longest without paying first; never-paid at the very top; then who owes most.
    report.rows.sort(key=lambda r: (-(r.months_unpaid if r.months_unpaid is not None else 10_000), -r.balance))
    return report
