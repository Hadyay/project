from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.common import Paging, apply_updates, get_or_404, paginate
from app.core.deps import CurrentUser, DbSession, get_current_user, require_perm
from app.models import Apartment, ApartmentStatus, Building, Contract, ContractStatus, Currency
from app.schemas.common import Message, Page
from app.schemas.property import (
    ApartmentCreate,
    ApartmentOut,
    ApartmentUpdate,
    ApartmentWithBuilding,
    BuildingCreate,
    BuildingOut,
    BuildingUpdate,
    BuildingWithCounts,
    UnitCounts,
)
from app.services import audit

buildings_router = APIRouter(
    prefix="/api/buildings", tags=["buildings"], dependencies=[Depends(get_current_user)]
)
apartments_router = APIRouter(
    prefix="/api/apartments", tags=["apartments"], dependencies=[Depends(get_current_user)]
)


def _unit_counts(db: Session, building_ids: list[int]) -> dict[int, UnitCounts]:
    """Per-building unit tallies for the card grid (15 مباعة · 8 مؤجّرة · …)."""
    if not building_ids:
        return {}

    rows = db.execute(
        select(Apartment.building_id, Apartment.status, func.count())
        .where(Apartment.building_id.in_(building_ids), ~Apartment.is_deleted)
        .group_by(Apartment.building_id, Apartment.status)
    ).all()

    counts = {bid: UnitCounts() for bid in building_ids}
    for building_id, unit_status, count in rows:
        bucket = counts[building_id]
        bucket.total += count
        setattr(bucket, unit_status.value, getattr(bucket, unit_status.value) + count)
    return counts


@buildings_router.get("", response_model=Page[BuildingWithCounts], dependencies=[Depends(require_perm("buildings.view", "units.view", "contracts.view", "contracts.create"))])
def list_buildings(db: DbSession, paging: Paging, q: str | None = None) -> Page[BuildingWithCounts]:
    stmt = select(Building).where(~Building.is_deleted).order_by(Building.name)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Building.name.ilike(like) | Building.code.ilike(like) | Building.city.ilike(like))

    rows, total = paginate(db, stmt, paging)
    counts = _unit_counts(db, [r.id for r in rows])
    items = [
        BuildingWithCounts(**BuildingOut.model_validate(r).model_dump(), units=counts[r.id]) for r in rows
    ]
    return Page(items=items, total=total, limit=paging.limit, offset=paging.offset)


@buildings_router.get("/{building_id}", response_model=BuildingWithCounts, dependencies=[Depends(require_perm("buildings.view"))])
def get_building(db: DbSession, building_id: int) -> BuildingWithCounts:
    building = get_or_404(db, Building, building_id)
    counts = _unit_counts(db, [building.id])
    return BuildingWithCounts(**BuildingOut.model_validate(building).model_dump(), units=counts[building.id])


@buildings_router.post(
    "", response_model=BuildingOut, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_perm("buildings.create"))],
)
def create_building(db: DbSession, payload: BuildingCreate, user: CurrentUser) -> Building:
    building = Building(**payload.model_dump(), created_by=user.id)
    db.add(building)
    db.flush()
    audit.record(db, table="buildings", record_id=building.id, action="insert", user=user, new=audit.snapshot(building))
    db.commit()
    db.refresh(building)
    return building


@buildings_router.patch("/{building_id}", response_model=BuildingOut, dependencies=[Depends(require_perm("buildings.edit"))])
def update_building(db: DbSession, building_id: int, payload: BuildingUpdate, user: CurrentUser) -> Building:
    building = get_or_404(db, Building, building_id)
    before = audit.snapshot(building)
    apply_updates(building, payload)
    audit.record(
        db, table="buildings", record_id=building.id, action="update", user=user,
        old=before, new=audit.snapshot(building),
    )
    db.commit()
    db.refresh(building)
    return building


@buildings_router.delete("/{building_id}", response_model=Message, dependencies=[Depends(require_perm("buildings.delete"))])
def delete_building(db: DbSession, building_id: int, user: CurrentUser) -> Message:
    building = get_or_404(db, Building, building_id)

    live_units = db.scalar(
        select(func.count()).select_from(Apartment).where(
            Apartment.building_id == building.id, ~Apartment.is_deleted
        )
    )
    if live_units:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Building still has {live_units} unit(s) — delete or move them first",
        )

    before = audit.snapshot(building)
    building.is_deleted = True
    building.deleted_at = datetime.now(UTC)
    building.deleted_by = user.id
    audit.record(
        db, table="buildings", record_id=building.id, action="delete", user=user,
        old=before, new=audit.snapshot(building),
    )
    db.commit()
    return Message(detail=f"Building {building.name} deleted")


# ------------------------------------------------------------------ apartments


@apartments_router.get("", response_model=Page[ApartmentWithBuilding], dependencies=[Depends(require_perm("units.view", "buildings.view", "contracts.view", "contracts.create", "reports.view"))])
def list_apartments(
    db: DbSession,
    paging: Paging,
    building_id: int | None = None,
    unit_status: ApartmentStatus | None = None,
    q: str | None = None,
) -> Page[ApartmentWithBuilding]:
    stmt = (
        select(Apartment)
        .where(~Apartment.is_deleted)
        .order_by(Apartment.building_id, Apartment.floor, Apartment.unit_no)
    )
    if building_id is not None:
        stmt = stmt.where(Apartment.building_id == building_id)
    if unit_status is not None:
        stmt = stmt.where(Apartment.status == unit_status)
    if q:
        # "432" should find the building's units, not just a unit called 432.
        like = f"%{q}%"
        stmt = stmt.where(
            Apartment.unit_no.ilike(like)
            | Apartment.building_id.in_(
                select(Building.id).where(Building.name.ilike(like) | Building.code.ilike(like))
            )
        )

    rows, total = paginate(db, stmt, paging)

    building_names = dict(
        db.execute(select(Building.id, Building.name).where(Building.id.in_([r.building_id for r in rows]))).all()
    ) if rows else {}
    currency_codes = dict(db.execute(select(Currency.id, Currency.code)).all())

    items = [
        ApartmentWithBuilding(
            **ApartmentOut.model_validate(r).model_dump(),
            building_name=building_names.get(r.building_id),
            price_currency_code=currency_codes.get(r.price_currency_id),
        )
        for r in rows
    ]
    return Page(items=items, total=total, limit=paging.limit, offset=paging.offset)


@apartments_router.get("/{apartment_id}", response_model=ApartmentOut, dependencies=[Depends(require_perm("units.view", "contracts.view"))])
def get_apartment(db: DbSession, apartment_id: int) -> Apartment:
    return get_or_404(db, Apartment, apartment_id)


@apartments_router.post(
    "", response_model=ApartmentOut, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_perm("units.create"))],
)
def create_apartment(db: DbSession, payload: ApartmentCreate, user: CurrentUser) -> Apartment:
    get_or_404(db, Building, payload.building_id, name="Building")

    clash = db.scalars(
        select(Apartment).where(
            Apartment.building_id == payload.building_id, Apartment.unit_no == payload.unit_no
        )
    ).one_or_none()
    if clash is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Unit '{payload.unit_no}' already exists in that building",
        )

    apartment = Apartment(**payload.model_dump(), created_by=user.id)
    db.add(apartment)
    db.flush()
    audit.record(
        db, table="apartments", record_id=apartment.id, action="insert", user=user, new=audit.snapshot(apartment)
    )
    db.commit()
    db.refresh(apartment)
    return apartment


@apartments_router.patch("/{apartment_id}", response_model=ApartmentOut, dependencies=[Depends(require_perm("units.edit"))])
def update_apartment(db: DbSession, apartment_id: int, payload: ApartmentUpdate, user: CurrentUser) -> Apartment:
    apartment = get_or_404(db, Apartment, apartment_id)
    before = audit.snapshot(apartment)
    apply_updates(apartment, payload)
    audit.record(
        db, table="apartments", record_id=apartment.id, action="update", user=user,
        old=before, new=audit.snapshot(apartment),
    )
    db.commit()
    db.refresh(apartment)
    return apartment


@apartments_router.delete("/{apartment_id}", response_model=Message, dependencies=[Depends(require_perm("units.delete"))])
def delete_apartment(db: DbSession, apartment_id: int, user: CurrentUser) -> Message:
    apartment = get_or_404(db, Apartment, apartment_id)

    live_contracts = db.scalar(
        select(func.count()).select_from(Contract).where(
            Contract.apartment_id == apartment.id,
            ~Contract.is_deleted,
            Contract.status.in_([ContractStatus.draft, ContractStatus.active]),
        )
    )
    if live_contracts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unit is tied to an open contract — close the contract first",
        )

    before = audit.snapshot(apartment)
    apartment.is_deleted = True
    apartment.deleted_at = datetime.now(UTC)
    apartment.deleted_by = user.id
    audit.record(
        db, table="apartments", record_id=apartment.id, action="delete", user=user,
        old=before, new=audit.snapshot(apartment),
    )
    db.commit()
    return Message(detail=f"Unit {apartment.unit_no} deleted")
