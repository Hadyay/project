from datetime import date

import pytest

from app.services.dates import add_months, months_between


@pytest.mark.parametrize(
    ("anchor", "months", "day", "expected"),
    [
        (date(2026, 1, 15), 1, None, date(2026, 2, 15)),
        (date(2026, 1, 31), 1, None, date(2026, 2, 28)),   # clamped to month end
        (date(2024, 1, 31), 1, None, date(2024, 2, 29)),   # leap year
        (date(2026, 11, 10), 3, None, date(2027, 2, 10)),  # rolls the year
        (date(2026, 1, 15), 0, 5, date(2026, 1, 5)),       # billing_day override
        (date(2026, 4, 10), 0, 31, date(2026, 4, 30)),     # override clamped too
    ],
)
def test_add_months(anchor: date, months: int, day: int | None, expected: date) -> None:
    assert add_months(anchor, months, day=day) == expected


@pytest.mark.parametrize(
    ("start", "end", "expected"),
    [
        (date(2026, 1, 10), date(2026, 12, 9), 11),   # last period runs Nov 10 - Dec 9
        (date(2026, 1, 10), date(2026, 12, 10), 12),  # the 10th opens one more period
        (date(2026, 1, 1), date(2026, 1, 1), 1),
        (date(2026, 6, 1), date(2026, 5, 1), 0),      # end before start
    ],
)
def test_months_between(start: date, end: date, expected: int) -> None:
    assert months_between(start, end) == expected
