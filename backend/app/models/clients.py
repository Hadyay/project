from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, ForeignKey, Identity, Index, Numeric, String, Text
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    code: Mapped[str | None] = mapped_column(String(30), unique=True)
    name_ar: Mapped[str] = mapped_column(String(200), nullable=False)
    name_en: Mapped[str | None] = mapped_column(String(200))
    national_id: Mapped[str | None] = mapped_column(String(50))
    phone: Mapped[str | None] = mapped_column(String(40))
    phone2: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(120))
    address: Mapped[str | None] = mapped_column(String(255))
    # Where the client bought, as the legacy customer card recorded it:
    # المشروع والعقار ("الهدفة 432"), بلوك ("بلوك B3"), طابق / جهة ("اول غربي").
    # Free text on the client, not a unit register - see CLAUDE.md "Next steps".
    project: Mapped[str | None] = mapped_column(String(100))
    block: Mapped[str | None] = mapped_column(String(40))
    floor_side: Mapped[str | None] = mapped_column(String(60))
    # What the client is expected to pay each month (القسط الشهري). When set,
    # paying less than this in a month counts as late; when empty, any
    # payment in the month counts as paid.
    monthly_installment: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    notes: Mapped[str | None] = mapped_column(Text)
    # each client is backed by one receivable account in the GL (old-system model)
    account_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("accounts.id"))

    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    deleted_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))

    __table_args__ = (
        Index("idx_clients_account", "account_id"),
        Index("idx_clients_name", "name_ar"),
    )
