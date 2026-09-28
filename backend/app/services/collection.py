"""Who paid which month — the one definition behind the reminders, the
dashboard's collection ring and جدول الدفعات.

A *window* is a period ("2026-09") with a start and an inclusive end date. For
each client and window:

- **owing** — the client's receivable balance just before the window starts
  is above `alert_settings.min_balance` (and above zero). A client who first
  owes during the month is not "owing" that month: nobody is late in the month
  they bought.
- **paid** — receipts dated inside the window, in base currency.
- **status**
  - `future`   — the window has not started yet (after as_of);
  - `before`   — the client had never been charged by the window's end;
  - `settled`  — not owing at the start and paid nothing (neutral), or owing at
                 the start but cleared without a receipt (an adjustment);
  - `paid`     — paid the monthly installment (when one is set on the client),
                 or anything at all (when none is set);
  - `short`    — paid something, but less than the installment;
  - `unpaid`   — owing at the start and paid nothing.
  `short` and `unpaid` are **late**.

Everything is read in three queries (ledger lines by day, receipts, client
cards) and settled in Python, so a year of windows for every client costs the
same as one.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from itertools import accumulate

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    AlertSettings,
    Client,
    Contract,
    ContractStatus,
    JournalEntry,
    JournalLine,
    PaymentSchedule,
    Receipt,
    ScheduleStatus,
)

ZERO = Decimal(0)
CENT = Decimal("0.01")
LATE = frozenset({"short", "unpaid"})


@dataclass(frozen=True)
class Window:
    period: str  # "YYYY-MM"
    start: date
    end: date  # inclusive


def month_start(day: date) -> date:
    return day.replace(day=1)


def next_month(day: date) -> date:
    first = month_start(day)
    return first.replace(year=first.year + 1, month=1) if first.month == 12 else first.replace(month=first.month + 1)


def add_months(first: date, n: int) -> date:
    total = first.year * 12 + (first.month - 1) + n
    return date(total // 12, total % 12 + 1, 1)


def calendar_window(first: date, as_of: date) -> Window:
    """The calendar month starting `first`, cut at as_of when it is running."""
    end = min(next_month(first) - timedelta(days=1), as_of) if first <= as_of else next_month(first) - timedelta(days=1)
    return Window(first.strftime("%Y-%m"), first, end)


def settings_row(db: Session) -> AlertSettings:
    row = db.get(AlertSettings, 1)
    if row is None:  # a database built by create_all (tests) has no seeded row
        row = AlertSettings(id=1, enabled=True, alert_day=1, min_balance=ZERO)
        db.add(row)
        db.flush()
    return row


@dataclass
class ClientMonth:
    owed_at_start: Decimal
    owed_at_end: Decimal
    paid: Decimal
    receipts: int
    status: str
    owing: bool

    @property
    def late(self) -> bool:
        return self.status in LATE


class Snapshot:
    """Balances, receipts and first charges for a set of clients, read once."""

    def __init__(self, db: Session, as_of: date, client_ids: list[int] | None = None):
        self.as_of = as_of
        self.min_balance = Decimal(settings_row(db).min_balance)

        stmt = select(Client).where(~Client.is_deleted, Client.account_id.is_not(None))
        if client_ids is not None:
            stmt = stmt.where(Client.id.in_(client_ids))
        self.clients: list[Client] = list(db.scalars(stmt.order_by(Client.code, Client.name_ar)).all())
        by_account = {c.account_id: c.id for c in self.clients}

        # Net movement per client per day, live entries only.
        self._days: dict[int, list[date]] = defaultdict(list)
        self._cum: dict[int, list[Decimal]] = {}
        self.first_charge: dict[int, date] = {}
        nets: dict[int, list[Decimal]] = defaultdict(list)
        if by_account:
            rows = db.execute(
                select(
                    JournalLine.account_id,
                    JournalEntry.entry_date,
                    func.sum(JournalLine.debit_base),
                    func.sum(JournalLine.credit_base),
                )
                .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
                .where(~JournalEntry.is_deleted, JournalLine.account_id.in_(by_account.keys()))
                .group_by(JournalLine.account_id, JournalEntry.entry_date)
                .order_by(JournalLine.account_id, JournalEntry.entry_date)
            ).all()
            for account_id, day, debit, credit in rows:
                cid = by_account[account_id]
                self._days[cid].append(day)
                nets[cid].append(Decimal(debit or 0) - Decimal(credit or 0))
                if (debit or 0) > 0 and cid not in self.first_charge:
                    self.first_charge[cid] = day
        for cid, values in nets.items():
            self._cum[cid] = list(accumulate(values))

        # Receipts per client, live, in base currency.
        self._r_days: dict[int, list[date]] = defaultdict(list)
        self._r_cum: dict[int, list[Decimal]] = {}
        amounts: dict[int, list[Decimal]] = defaultdict(list)
        ids = [c.id for c in self.clients]
        if ids:
            for cid, day, amount in db.execute(
                select(Receipt.client_id, Receipt.receipt_date, Receipt.amount * Receipt.exchange_rate)
                .where(~Receipt.is_deleted, Receipt.client_id.in_(ids))
                .order_by(Receipt.client_id, Receipt.receipt_date)
            ).all():
                self._r_days[cid].append(day)
                amounts[cid].append(Decimal(amount).quantize(CENT))
        for cid, values in amounts.items():
            self._r_cum[cid] = list(accumulate(values))

    # -- ledger ----------------------------------------------------------------
    def balance_through(self, cid: int, day: date) -> Decimal:
        """Balance including every entry dated on or before `day`."""
        i = bisect_right(self._days.get(cid, []), day)
        return self._cum[cid][i - 1] if i else ZERO

    def balance_before(self, cid: int, day: date) -> Decimal:
        i = bisect_left(self._days.get(cid, []), day)
        return self._cum[cid][i - 1] if i else ZERO

    # -- receipts --------------------------------------------------------------
    def paid_between(self, cid: int, start: date, end: date) -> tuple[Decimal, int]:
        days = self._r_days.get(cid, [])
        lo, hi = bisect_left(days, start), bisect_right(days, end)
        if hi <= lo:
            return ZERO, 0
        cum = self._r_cum[cid]
        return cum[hi - 1] - (cum[lo - 1] if lo else ZERO), hi - lo

    def last_receipt(self, cid: int, on_or_before: date) -> date | None:
        days = self._r_days.get(cid, [])
        i = bisect_right(days, on_or_before)
        return days[i - 1] if i else None

    # -- the rule --------------------------------------------------------------
    def month(self, client: Client, window: Window) -> ClientMonth:
        cid = client.id
        owed_start = self.balance_before(cid, window.start)
        if window.start > self.as_of:
            return ClientMonth(owed_start, owed_start, ZERO, 0, "future", False)
        owed_end = self.balance_through(cid, window.end)
        paid, count = self.paid_between(cid, window.start, window.end)
        owing = owed_start > 0 and owed_start > self.min_balance
        installment = Decimal(client.monthly_installment) if client.monthly_installment else None

        if not owing:
            if paid > 0:
                status = "paid"
            elif cid not in self.first_charge or self.first_charge[cid] > window.end:
                status = "before"
            else:
                status = "settled"
        elif paid == 0 and owed_end <= 0:
            status = "settled"  # cleared by an adjustment, not a receipt
        elif installment is not None:
            status = "paid" if paid >= installment else ("short" if paid > 0 else "unpaid")
        else:
            status = "paid" if paid > 0 else "unpaid"
        return ClientMonth(owed_start, owed_end, paid, count, status, owing)


def overdue_installments(db: Session, as_of: date, client_ids: list[int]) -> dict[int, tuple[int, Decimal]]:
    """Unpaid contract installments due before as_of, per client (active contracts)."""
    if not client_ids:
        return {}
    return {
        cid: (n, Decimal(amount or 0).quantize(CENT))
        for cid, n, amount in db.execute(
            select(Contract.client_id, func.count(), func.sum(PaymentSchedule.amount - PaymentSchedule.paid_amount))
            .join(Contract, Contract.id == PaymentSchedule.contract_id)
            .where(
                ~Contract.is_deleted,
                Contract.status == ContractStatus.active,
                Contract.client_id.in_(client_ids),
                PaymentSchedule.due_date < as_of,
                PaymentSchedule.status.in_([ScheduleStatus.pending, ScheduleStatus.partial, ScheduleStatus.overdue]),
                PaymentSchedule.amount > PaymentSchedule.paid_amount,
            )
            .group_by(Contract.client_id)
        ).all()
    }


# ---------------------------------------------------------------- collection


@dataclass
class MonthRate:
    period: str
    owing_at_start: int
    paid: int
    late: int
    rate: Decimal  # 0–100, 2 dp; 0 when nobody owed
    amount_collected: Decimal  # every receipt in the month, all clients
    expected: Decimal | None  # sum of the owing clients' installments, when any is set


def collection(db: Session, as_of: date, months: int = 6) -> list[MonthRate]:
    """The last `months` calendar months up to as_of's month, oldest first.

    The running month also counts overdue contract installments as late, the
    same as the reminders — so on and after the alert day the ring's "late"
    equals the alerts list's count."""
    snap = Snapshot(db, as_of)
    current_first = month_start(as_of)
    overdue = overdue_installments(db, as_of, [c.id for c in snap.clients])
    out: list[MonthRate] = []
    for k in range(months - 1, -1, -1):
        window = calendar_window(add_months(current_first, -k), as_of)
        owing = paid = late = 0
        collected = ZERO
        expected = ZERO
        any_installment = False
        running = window.start == current_first
        for client in snap.clients:
            cm = snap.month(client, window)
            collected += cm.paid
            if not cm.owing:
                continue
            owing += 1
            if client.monthly_installment:
                any_installment = True
                expected += Decimal(client.monthly_installment)
            is_late = cm.late or (running and client.id in overdue and snap.balance_through(client.id, as_of) > 0)
            if is_late:
                late += 1
            else:
                paid += 1
        rate = (Decimal(paid) * 100 / owing).quantize(CENT) if owing else ZERO
        out.append(
            MonthRate(window.period, owing, paid, late, rate, collected.quantize(CENT), expected.quantize(CENT) if any_installment else None)
        )
    return out


# ---------------------------------------------------------------- the grid


@dataclass
class GridCell:
    period: str
    paid: Decimal
    receipts: int
    status: str


@dataclass
class GridRow:
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
    cells: list[GridCell]
    total_paid: Decimal

    @property
    def late_months(self) -> int:
        return sum(1 for c in self.cells if c.status in LATE)


@dataclass
class GridTotal:
    period: str
    paid_amount: Decimal
    paid_clients: int
    owing_clients: int
    rate: Decimal


def _fold(text: str) -> str:
    """Arabic-insensitive matching, as the frontend's SearchPanel does it."""
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ة", "ه"), ("ى", "ي")):
        text = text.replace(a, b)
    return "".join(ch for ch in text.lower() if not ("ً" <= ch <= "ْ" or ch == "ـ"))


def _matches(client: Client, needle: str, digits: str | None) -> bool:
    """The fields the clients list searches, plus the second phone. Phones
    are stored as bare digits, so "70 714 379" or "70-714379" match too."""
    fields = (client.name_ar, client.name_en, client.code, client.phone, client.phone2,
              client.national_id, client.project, client.block)
    if any(needle in _fold(v) for v in fields if v):
        return True
    return bool(digits) and any(
        digits in "".join(ch for ch in p if ch.isdigit()) for p in (client.phone, client.phone2) if p
    )


def grid(
    db: Session,
    year: int,
    as_of: date,
    late_ids: set[int],
    q: str | None = None,
    only_late: bool = False,
    project: str | None = None,
) -> tuple[list[Window], list[GridRow], list[GridTotal]]:
    """جدول الدفعات: every client × the 12 months of `year`.

    A client is listed when something happened that year or they still owe;
    `late_ids` (the reminders' current cycle) marks the row red. Totals are
    over the listed rows, so a filter narrows them too."""
    snap = Snapshot(db, as_of)
    windows = [calendar_window(date(year, m, 1), as_of) for m in range(1, 13)]
    needle = _fold(q.strip()) if q and q.strip() else None
    compact = "".join(ch for ch in (q or "") if ch not in " -/.()+")
    digits = compact if len(compact) >= 3 and compact.isdigit() else None

    rows: list[GridRow] = []
    months: dict[str, list[ClientMonth]] = defaultdict(list)
    for client in snap.clients:
        if project and client.project != project:
            continue
        if needle and not _matches(client, needle, digits):
            continue
        cms = [snap.month(client, w) for w in windows]
        balance = snap.balance_through(client.id, as_of).quantize(CENT)
        active = any(cm.status not in ("before", "settled", "future") for cm in cms)
        if not active and balance == 0:
            continue
        row = GridRow(
            client_id=client.id,
            code=client.code,
            name=client.name_ar,
            phone=client.phone,
            project=client.project,
            block=client.block,
            balance=balance,
            monthly_installment=Decimal(client.monthly_installment) if client.monthly_installment else None,
            first_charge_date=snap.first_charge.get(client.id),
            late=client.id in late_ids,
            cells=[GridCell(w.period, cm.paid.quantize(CENT), cm.receipts, cm.status) for w, cm in zip(windows, cms)],
            total_paid=sum((cm.paid for cm in cms), ZERO).quantize(CENT),
        )
        if only_late and not (row.late or row.late_months):
            continue
        rows.append(row)
        for w, cm in zip(windows, cms):
            months[w.period].append(cm)

    rows.sort(key=lambda r: (-r.late_months, not r.late, -r.balance, r.code or ""))
    totals = []
    for w in windows:
        cms = months.get(w.period, [])
        owing = [cm for cm in cms if cm.owing]
        paid_clients = sum(1 for cm in owing if not cm.late)
        totals.append(
            GridTotal(
                period=w.period,
                paid_amount=sum((cm.paid for cm in cms), ZERO).quantize(CENT),
                paid_clients=paid_clients,
                owing_clients=len(owing),
                rate=(Decimal(paid_clients) * 100 / len(owing)).quantize(CENT) if owing else ZERO,
            )
        )
    return windows, rows, totals
