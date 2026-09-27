from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, ForeignKey, Identity, Index, Numeric, SmallInteger, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Currency(Base):
    __tablename__ = "currencies"

    id: Mapped[int] = mapped_column(SmallInteger, Identity(), primary_key=True)
    code: Mapped[str] = mapped_column(String(3), nullable=False, unique=True)
    name_ar: Mapped[str] = mapped_column(String(60), nullable=False)
    name_en: Mapped[str] = mapped_column(String(60), nullable=False)
    symbol: Mapped[str | None] = mapped_column(String(8))
    is_base: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    __table_args__ = (
        Index("one_base_currency", "is_base", unique=True, postgresql_where=text("is_base")),
    )


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    currency_id: Mapped[int] = mapped_column(SmallInteger, ForeignKey("currencies.id"), nullable=False)
    rate_date: Mapped[date] = mapped_column(Date, nullable=False)
    rate_to_base: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False)

    __table_args__ = (Index("uq_exchange_rates_currency_date", "currency_id", "rate_date", unique=True),)


class Role(Base):
    """A named set of permissions (app/core/permissions.py), edited by the
    administrator from الإعدادات. The system role holds every permission and
    cannot be changed; the others are plain data."""

    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    permissions: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    username: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(120))
    role_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("roles.id"), nullable=False)
    # Loaded with the user on every request, so a changed role applies at once.
    role: Mapped[Role] = relationship(lazy="joined")
    # Per-person interface choices (theme, language, simple mode) — on the user,
    # not in a browser, so they follow the person to any PC. Read through
    # schemas.auth.Preferences, which fills the defaults.
    preferences: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
