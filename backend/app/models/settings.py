from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, CheckConstraint, ForeignKey, Identity, Numeric, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class OrgSettings(Base):
    """Who the printed documents come from — one row, forever.

    Every voucher, statement and report carries this letterhead, so it cannot
    live in the frontend bundle or in a browser's storage: two clerks printing
    the same receipt must produce the same piece of paper. The legacy system
    kept it in CONFIGS.csv for the same reason.

    The single-row constraint is enforced in the database rather than by
    convention, because "settings" tables that allow a second row eventually
    get one, and then nothing agrees on which is current.
    """

    __tablename__ = "org_settings"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    subtitle: Mapped[str | None] = mapped_column(String(150))
    address: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(60))
    email: Mapped[str | None] = mapped_column(String(120))
    tax_no: Mapped[str | None] = mapped_column(String(60))
    footer_note: Mapped[str | None] = mapped_column(String(255))
    # The letterhead logo, as a `data:image/...;base64,...` URI.
    #
    # Kept in the row rather than on a disk or an object store because this
    # app has neither, and a logo that lives beside the data survives a
    # pg_dump/restore with it — a backup that loses the letterhead is a
    # backup that cannot reprint last year's receipts. Size is capped in the
    # schema; a letterhead is a few tens of kilobytes, not a photograph.
    logo: Mapped[str | None] = mapped_column(Text)

    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default="now()"
    )
    updated_by: Mapped[int | None] = mapped_column(BigInteger)

    __table_args__ = (CheckConstraint("id = 1", name="org_settings_single_row"),)


class AlertSettings(Base):
    """The monthly payment reminder (التنبيهات) — one row.

    From `alert_day` of each month on, every client who still owes more than
    `min_balance` and has not paid this month (or paid less than their
    monthly installment) is listed as late. Computed live from the ledger in
    app/services/reminders.py; nothing is stored per month except the
    office's own "reminded" marks (ClientReminder)."""

    __tablename__ = "alert_settings"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    alert_day: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1, server_default="1")
    min_balance: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default="now()"
    )
    updated_by: Mapped[int | None] = mapped_column(BigInteger)

    __table_args__ = (
        CheckConstraint("id = 1", name="alert_settings_single_row"),
        # 28 is the last day every month has.
        CheckConstraint("alert_day BETWEEN 1 AND 28", name="alert_settings_day_range"),
    )


class ClientReminder(Base):
    """The office noted it reminded a client for a month ("تم التذكير")."""

    __tablename__ = "client_reminders"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    client_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("clients.id"), nullable=False)
    period: Mapped[str] = mapped_column(String(7), nullable=False)  # YYYY-MM
    note: Mapped[str | None] = mapped_column(Text)
    reminded_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default="now()"
    )
    reminded_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))

    __table_args__ = (UniqueConstraint("client_id", "period", name="client_reminders_client_period"),)
