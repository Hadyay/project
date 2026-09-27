from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Currency, ExchangeRate

CENTS = Decimal("0.01")


def to_base(amount: Decimal, rate: Decimal) -> Decimal:
    """Convert a transaction-currency amount to base, rounded to cents."""
    return (Decimal(amount) * Decimal(rate)).quantize(CENTS, rounding=ROUND_HALF_UP)


def base_currency(db: Session) -> Currency:
    currency = db.scalars(select(Currency).where(Currency.is_base)).one_or_none()
    if currency is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No base currency configured — exactly one currency must have is_base = true",
        )
    return currency


def rate_for(db: Session, currency_id: int, on_date: date) -> Decimal:
    """Rate converting `currency_id` to base on `on_date`.

    Uses the most recent rate on or before that date; the base currency is
    always 1. Raises 400 when a non-base currency has no rate yet, because
    posting at a guessed rate would silently corrupt the ledger.
    """
    currency = db.get(Currency, currency_id)
    if currency is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown currency_id {currency_id}"
        )
    if currency.is_base:
        return Decimal(1)

    rate = db.scalars(
        select(ExchangeRate.rate_to_base)
        .where(ExchangeRate.currency_id == currency_id, ExchangeRate.rate_date <= on_date)
        .order_by(ExchangeRate.rate_date.desc())
        .limit(1)
    ).one_or_none()

    if rate is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No exchange rate for {currency.code} on or before {on_date}",
        )
    return Decimal(rate)
