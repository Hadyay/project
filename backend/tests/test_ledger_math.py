from decimal import Decimal

from app.schemas.ledger import JournalLineIn
from app.services.fx import to_base
from app.services.ledger import _base_amounts


def test_to_base_rounds_to_cents() -> None:
    assert to_base(Decimal("100"), Decimal("0.0000111")) == Decimal("0.00")
    assert to_base(Decimal("1500000"), Decimal("0.0000111")) == Decimal("16.65")
    assert to_base(Decimal("10"), Decimal("1.005")) == Decimal("10.05")


def test_base_amounts_stay_balanced_after_rounding() -> None:
    """Per-line rounding must not leave the base totals a cent apart — the DB's
    balance trigger rejects that."""
    lines = [
        JournalLineIn(account_id=1, debit=Decimal("33.33")),
        JournalLineIn(account_id=2, debit=Decimal("33.33")),
        JournalLineIn(account_id=3, debit=Decimal("33.34")),
        JournalLineIn(account_id=4, credit=Decimal("100.00")),
    ]
    converted = _base_amounts(lines, Decimal("1.005"))

    debit = sum(d for d, _ in converted)
    credit = sum(c for _, c in converted)
    assert debit == credit


def test_base_amounts_identity_at_rate_one() -> None:
    lines = [
        JournalLineIn(account_id=1, debit=Decimal("250.00")),
        JournalLineIn(account_id=2, credit=Decimal("250.00")),
    ]
    assert _base_amounts(lines, Decimal(1)) == [
        (Decimal("250.00"), Decimal("0.00")),
        (Decimal("0.00"), Decimal("250.00")),
    ]
