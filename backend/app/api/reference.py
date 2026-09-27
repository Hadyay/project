from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession, get_current_user, require_perm
from app.models import Currency, ExchangeRate, OrgSettings
from app.schemas.reference import (
    CurrencyOut,
    ExchangeRateCreate,
    ExchangeRateOut,
    OrgSettingsOut,
    OrgSettingsUpdate,
)
from app.services import audit
from app.services.fx import rate_for

router = APIRouter(prefix="/api", tags=["reference"], dependencies=[Depends(get_current_user)])


@router.get("/currencies", response_model=list[CurrencyOut])
def list_currencies(db: DbSession) -> list[Currency]:
    return list(db.scalars(select(Currency).order_by(Currency.is_base.desc(), Currency.code)).all())


@router.get("/exchange-rates", response_model=list[ExchangeRateOut])
def list_rates(
    db: DbSession,
    currency_id: int | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
) -> list[ExchangeRate]:
    stmt = select(ExchangeRate).order_by(ExchangeRate.rate_date.desc()).limit(limit)
    if currency_id is not None:
        stmt = stmt.where(ExchangeRate.currency_id == currency_id)
    return list(db.scalars(stmt).all())


@router.post(
    "/exchange-rates",
    response_model=ExchangeRateOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_perm("settings.rates"))],
)
def upsert_rate(db: DbSession, payload: ExchangeRateCreate) -> ExchangeRate:
    currency = db.get(Currency, payload.currency_id)
    if currency is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown currency")
    if currency.is_base:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The base currency is always 1 and takes no rate rows",
        )

    existing = db.scalars(
        select(ExchangeRate).where(
            ExchangeRate.currency_id == payload.currency_id,
            ExchangeRate.rate_date == payload.rate_date,
        )
    ).one_or_none()

    if existing is not None:
        existing.rate_to_base = payload.rate_to_base
        db.commit()
        db.refresh(existing)
        return existing

    rate = ExchangeRate(**payload.model_dump())
    db.add(rate)
    db.commit()
    db.refresh(rate)
    return rate


@router.get("/exchange-rates/effective")
def effective_rate(db: DbSession, currency_id: int, on: date | None = None) -> dict:
    """The rate the ledger would actually use for a posting on `on`."""
    on_date = on or date.today()
    return {"currency_id": currency_id, "date": on_date, "rate_to_base": rate_for(db, currency_id, on_date)}


# ------------------------------------------------------------- org settings

ORG_SETTINGS_ID = 1

DEFAULT_ORG = {
    "name": "إدارة العقارات",
    "subtitle": "مجمّع الأبنية — بيروت",
}


def _org_row(db: DbSession) -> OrgSettings:
    """The one settings row, created on first read.

    Reading settings should never 404 — a fresh database has a letterhead too,
    it is just the default one — so the row is materialised lazily instead of
    being seeded, which keeps `app.seed.run` out of the business of defaults
    that the client will overwrite on day one anyway.
    """
    row = db.get(OrgSettings, ORG_SETTINGS_ID)
    if row is None:
        row = OrgSettings(id=ORG_SETTINGS_ID, **DEFAULT_ORG)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.get("/org-settings", response_model=OrgSettingsOut)
def get_org_settings(db: DbSession) -> OrgSettings:
    return _org_row(db)


@router.put(
    "/org-settings", response_model=OrgSettingsOut, dependencies=[Depends(require_perm("settings.org"))]
)
def update_org_settings(
    db: DbSession, payload: OrgSettingsUpdate, user: CurrentUser
) -> OrgSettings:
    """Change the letterhead. Admin only — it appears on every document."""
    row = _org_row(db)
    before = audit.snapshot(row)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    row.updated_by = user.id

    audit.record(
        db, table="org_settings", record_id=row.id, action="update", user=user,
        old=before, new=audit.snapshot(row),
    )
    db.commit()
    db.refresh(row)
    return row
