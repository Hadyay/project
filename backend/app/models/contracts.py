from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, ContractStatus, ContractType, ScheduleStatus, pg_enum


class Contract(Base):
    __tablename__ = "contracts"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    contract_no: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    contract_type: Mapped[ContractType] = mapped_column(pg_enum(ContractType, "contract_type"), nullable=False)
    client_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("clients.id"), nullable=False)
    apartment_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("apartments.id"), nullable=False)
    currency_id: Mapped[int] = mapped_column(SmallInteger, ForeignKey("currencies.id"), nullable=False)
    status: Mapped[ContractStatus] = mapped_column(
        pg_enum(ContractStatus, "contract_status"), nullable=False, default=ContractStatus.draft,
        server_default="draft",
    )
    sign_date: Mapped[date | None] = mapped_column(Date)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)  # rent: lease end; sale: usually null

    # SALE fields
    total_amount: Mapped[float | None] = mapped_column(Numeric(18, 2))
    down_payment: Mapped[float | None] = mapped_column(Numeric(18, 2))
    installment_count: Mapped[int | None] = mapped_column(SmallInteger)

    # RENT fields
    monthly_rent: Mapped[float | None] = mapped_column(Numeric(18, 2))
    deposit: Mapped[float | None] = mapped_column(Numeric(18, 2))
    billing_day: Mapped[int | None] = mapped_column(SmallInteger)

    notes: Mapped[str | None] = mapped_column(Text)

    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    deleted_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))

    __table_args__ = (
        CheckConstraint(
            "contract_type <> 'sale' OR total_amount IS NOT NULL", name="sale_needs_total"
        ),
        CheckConstraint(
            "contract_type <> 'rent' OR monthly_rent IS NOT NULL", name="rent_needs_rent"
        ),
        Index("idx_contracts_client", "client_id"),
        Index("idx_contracts_apartment", "apartment_id"),
        Index("idx_contracts_status", "status"),
    )


class PaymentSchedule(Base):
    __tablename__ = "payment_schedule"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    contract_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False
    )
    seq_no: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False)
    currency_id: Mapped[int] = mapped_column(SmallInteger, ForeignKey("currencies.id"), nullable=False)
    paid_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default="0")
    status: Mapped[ScheduleStatus] = mapped_column(
        pg_enum(ScheduleStatus, "schedule_status"), nullable=False, default=ScheduleStatus.pending,
        server_default="pending",
    )

    __table_args__ = (
        UniqueConstraint("contract_id", "seq_no"),
        Index("idx_schedule_contract", "contract_id"),
        Index("idx_schedule_due", "due_date", postgresql_where=text("status <> 'paid'")),
    )
