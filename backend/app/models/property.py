from datetime import datetime

from sqlalchemy import BigInteger, Boolean, ForeignKey, Identity, Index, Numeric, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import ApartmentStatus, ApartmentType, Base, pg_enum


class Building(Base):
    __tablename__ = "buildings"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    code: Mapped[str | None] = mapped_column(String(30), unique=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    address: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str | None] = mapped_column(String(80))
    floors_count: Mapped[int | None] = mapped_column(SmallInteger)
    description: Mapped[str | None] = mapped_column(Text)

    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    deleted_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))


class Apartment(Base):
    __tablename__ = "apartments"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    building_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("buildings.id"), nullable=False)
    unit_no: Mapped[str] = mapped_column(String(30), nullable=False)
    floor: Mapped[int | None] = mapped_column(SmallInteger)
    area_m2: Mapped[float | None] = mapped_column(Numeric(10, 2))
    unit_type: Mapped[ApartmentType] = mapped_column(
        pg_enum(ApartmentType, "apartment_type"), nullable=False, default=ApartmentType.apartment,
        server_default="apartment",
    )
    status: Mapped[ApartmentStatus] = mapped_column(
        pg_enum(ApartmentStatus, "apartment_status"), nullable=False, default=ApartmentStatus.available,
        server_default="available",
    )
    listed_price: Mapped[float | None] = mapped_column(Numeric(18, 2))
    price_currency_id: Mapped[int | None] = mapped_column(SmallInteger, ForeignKey("currencies.id"))
    description: Mapped[str | None] = mapped_column(Text)

    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    deleted_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))

    __table_args__ = (
        UniqueConstraint("building_id", "unit_no"),
        Index("idx_apartments_building", "building_id"),
        Index("idx_apartments_status", "status"),
    )
