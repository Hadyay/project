"""Monthly payment reminders — who has not paid, computed live from the ledger.

The office sets one day of the month (alert_settings.alert_day, 1–28). Each
month is a *cycle* that opens on that day and runs until the next month's
alert day; the cycle in force on `as_of` is the one whose alert day has come.
A client is **late** in a cycle when:

  - their receivable balance is above the configured minimum (they still owe),
  - and since the start of the cycle's month they have paid nothing — or less
    than their monthly installment, when one is set on the client —
  - or an installment on an active contract is past due and unpaid.

So on the alert day every client who owes and has not paid this month turns
red, and stays red until a receipt covers the month — no job to run, nothing
to reset: recording the receipt is what clears the alert. Before the alert day
the previous month's cycle is still in force, so a client who missed last
month does not disappear from the list on the 1st.

`months_unpaid` counts whole months since the last receipt (0 = paid this
month, but short of the installment); None means the client never paid.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    AlertSettings,
    Client,
    ClientReminder,
    Contract,
    ContractStatus,
    JournalEntry,
    JournalLine,
    PaymentSchedule,
    Receipt,
    ScheduleStatus,
    User,
)

CENT = Decimal("0.01")


def settings_row(db: Session) -> AlertSettings:
    row = db.get(AlertSettings, 1)
    if row is None:  # a database built by create_all (tests) has no seeded row
        row = AlertSettings(id=1, enabled=True, alert_day=1, min_balance=Decimal(0))
        db.add(row)
        db.flush()
    return row


def _month_start(day: date) -> date:
    return day.replace(day=1)


def _previous_month_start(day: date) -> date:
    first = _month_start(day)
    return (first.replace(year=first.year - 1, month=12) if first.month == 1 else first.replace(month=first.month - 1))


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
        nxt = (start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1))
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

    # Receivable balance per account over live entries (trial-balance shape).
    balance = (
        select(
            JournalLine.account_id.label("account_id"),
            func.sum(JournalLine.debit_base - JournalLine.credit_base).label("balance"),
        )
        .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
        .where(~JournalEntry.is_deleted, JournalEntry.entry_date <= as_of)
        .group_by(JournalLine.account_id)
        .subquery()
    )
    clients_stmt = (
        select(Client, balance.c.balance)
        .join(balance, balance.c.account_id == Client.account_id)
        .where(~Client.is_deleted, balance.c.balance > settings.min_balance, balance.c.balance > 0)
    )
    if client_id is not None:
        clients_stmt = clients_stmt.where(Client.id == client_id)
    owing = db.execute(clients_stmt).all()
    if not owing:
        return report
    ids = [client.id for client, _ in owing]

    live_receipts = select(Receipt).where(~Receipt.is_deleted, Receipt.client_id.in_(ids), Receipt.receipt_date <= as_of)
    paid = dict(
        db.execute(
            select(Receipt.client_id, func.sum(Receipt.amount * Receipt.exchange_rate))
            .where(~Receipt.is_deleted, Receipt.client_id.in_(ids))
            .where(Receipt.receipt_date >= cycle.start, Receipt.receipt_date <= as_of)
            .group_by(Receipt.client_id)
        ).all()
    )
    last = dict(
        db.execute(
            select(Receipt.client_id, func.max(Receipt.receipt_date))
            .where(live_receipts.whereclause)
            .group_by(Receipt.client_id)
        ).all()
    )
    overdue = {
        cid: (n, amount)
        for cid, n, amount in db.execute(
            select(
                Contract.client_id,
                func.count(),
                func.sum(PaymentSchedule.amount - PaymentSchedule.paid_amount),
            )
            .join(Contract, Contract.id == PaymentSchedule.contract_id)
            .where(
                ~Contract.is_deleted,
                Contract.status == ContractStatus.active,
                Contract.client_id.in_(ids),
                PaymentSchedule.due_date < as_of,
                PaymentSchedule.status.in_([ScheduleStatus.pending, ScheduleStatus.partial, ScheduleStatus.overdue]),
                PaymentSchedule.amount > PaymentSchedule.paid_amount,
            )
            .group_by(Contract.client_id)
        ).all()
    }
    reminders = {
        rem.client_id: (rem, username)
        for rem, username in db.execute(
            select(ClientReminder, User.username)
            .outerjoin(User, User.id == ClientReminder.reminded_by)
            .where(ClientReminder.period == cycle.period, ClientReminder.client_id.in_(ids))
        ).all()
    }

    for client, owed in owing:
        paid_now = Decimal(paid.get(client.id) or 0).quantize(CENT)
        installment = Decimal(client.monthly_installment) if client.monthly_installment else None
        n_overdue, overdue_amount = overdue.get(client.id, (0, Decimal(0)))
        if installment is not None:
            short = paid_now < installment
            reason = "short" if paid_now > 0 else "no_payment"
        else:
            short = paid_now == 0
            reason = "no_payment"
        if not short and not n_overdue:
            continue
        if not short:
            reason = "overdue_installment"
        last_date = last.get(client.id)
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
                balance=Decimal(owed).quantize(CENT),
                monthly_installment=installment,
                paid_this_cycle=paid_now,
                last_payment_date=last_date,
                months_unpaid=months_between(last_date, as_of) if last_date else None,
                overdue_installments=n_overdue,
                overdue_amount=Decimal(overdue_amount or 0).quantize(CENT),
                reason=reason,
                reminded_at=rem[0].reminded_at if rem else None,
                reminded_by=rem[1] if rem else None,
                reminder_note=rem[0].note if rem else None,
            )
        )

    # Longest without paying first; never-paid at the very top; then who owes most.
    report.rows.sort(key=lambda r: (-(r.months_unpaid if r.months_unpaid is not None else 10_000), -r.balance))
    return report
