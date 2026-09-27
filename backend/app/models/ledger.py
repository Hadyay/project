from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Identity,
    Index,
    Numeric,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, EntryType, pg_enum


class JournalEntry(Base):
    """Document header. Mirrors old JOURNAL (typed سند/مبيع/قبض/صرف)."""

    __tablename__ = "journal_entries"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    entry_no: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    entry_type: Mapped[EntryType] = mapped_column(pg_enum(EntryType, "entry_type"), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # optional link back to what generated this entry
    contract_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("contracts.id"))
    currency_id: Mapped[int] = mapped_column(SmallInteger, ForeignKey("currencies.id"), nullable=False)
    exchange_rate: Mapped[float] = mapped_column(
        Numeric(20, 6), nullable=False, default=1, server_default="1"
    )  # txn currency -> base
    is_posted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    deleted_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))

    lines: Mapped[list["JournalLine"]] = relationship(
        "JournalLine", back_populates="entry", cascade="all, delete-orphan", order_by="JournalLine.id"
    )

    __table_args__ = (
        Index("idx_entries_date", "entry_date"),
        Index("idx_entries_type", "entry_type"),
        Index("idx_entries_contract", "contract_id"),
    )


class JournalLine(Base):
    """Ledger lines. Mirrors old SACCOUNT: debit/credit in txn + base currency."""

    __tablename__ = "journal_lines"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    entry_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("journal_entries.id", ondelete="CASCADE"), nullable=False
    )
    account_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("accounts.id"), nullable=False)
    client_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("clients.id"))
    debit: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default="0")
    credit: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default="0")
    debit_base: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default="0")
    credit_base: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default="0")
    line_desc: Mapped[str | None] = mapped_column(String(255))

    entry: Mapped["JournalEntry"] = relationship("JournalEntry", back_populates="lines")

    __table_args__ = (
        CheckConstraint("debit = 0 OR credit = 0", name="one_sided"),
        Index("idx_lines_entry", "entry_id"),
        Index("idx_lines_account", "account_id"),
        Index("idx_lines_client", "client_id"),
    )
