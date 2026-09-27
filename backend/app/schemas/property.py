from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.base import ApartmentStatus, ApartmentType
from app.schemas.common import ORMModel


class BuildingBase(BaseModel):
    code: str | None = Field(default=None, max_length=30)
    name: str = Field(max_length=150)
    address: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=80)
    floors_count: int | None = Field(default=None, ge=0, le=200)
    description: str | None = None


class BuildingCreate(BuildingBase):
    pass


class BuildingUpdate(BaseModel):
    code: str | None = Field(default=None, max_length=30)
    name: str | None = Field(default=None, max_length=150)
    address: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=80)
    floors_count: int | None = Field(default=None, ge=0, le=200)
    description: str | None = None


class BuildingOut(ORMModel, BuildingBase):
    id: int
    created_at: datetime
    updated_at: datetime


class UnitCounts(BaseModel):
    total: int = 0
    sold: int = 0
    rented: int = 0
    reserved: int = 0
    available: int = 0
    unavailable: int = 0


class BuildingWithCounts(BuildingOut):
    """Drives the buildings card grid (15 مباعة · 8 مؤجّرة · …)."""

    units: UnitCounts


class ApartmentBase(BaseModel):
    building_id: int
    unit_no: str = Field(max_length=30)
    floor: int | None = Field(default=None, ge=-10, le=200)
    area_m2: Decimal | None = Field(default=None, ge=0)
    unit_type: ApartmentType = ApartmentType.apartment
    status: ApartmentStatus = ApartmentStatus.available
    listed_price: Decimal | None = Field(default=None, ge=0)
    price_currency_id: int | None = None
    description: str | None = None


class ApartmentCreate(ApartmentBase):
    pass


class ApartmentUpdate(BaseModel):
    building_id: int | None = None
    unit_no: str | None = Field(default=None, max_length=30)
    floor: int | None = Field(default=None, ge=-10, le=200)
    area_m2: Decimal | None = Field(default=None, ge=0)
    unit_type: ApartmentType | None = None
    status: ApartmentStatus | None = None
    listed_price: Decimal | None = Field(default=None, ge=0)
    price_currency_id: int | None = None
    description: str | None = None


class ApartmentOut(ORMModel, ApartmentBase):
    id: int
    created_at: datetime
    updated_at: datetime


class ApartmentWithBuilding(ApartmentOut):
    building_name: str | None = None
    price_currency_code: str | None = None
