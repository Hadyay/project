import calendar
from datetime import date


def add_months(anchor: date, months: int, *, day: int | None = None) -> date:
    """`anchor` shifted by `months`, clamped to the end of the target month.

    `day` overrides the day-of-month (the contract's billing_day); it is clamped
    the same way, so billing_day=31 lands on the 28th/30th where needed.
    """
    total = anchor.month - 1 + months
    year = anchor.year + total // 12
    month = total % 12 + 1
    wanted = day if day is not None else anchor.day
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(wanted, last))


def months_between(start: date, end: date) -> int:
    """Whole months from `start` to `end`, inclusive of the starting month.

    A lease 2026-01-10 → 2026-12-09 bills 11 periods; → 2026-12-10 bills 12.
    """
    months = (end.year - start.year) * 12 + (end.month - start.month)
    if end.day < start.day:
        months -= 1
    return max(months + 1, 0)
