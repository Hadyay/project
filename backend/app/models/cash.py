from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, ForeignKey, Identity, Index, Numeric, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, PaymentMethod, pg_enum


class Receipt(Base):
    """Receipts (قبض) — money IN, always linked to a client. Mirrors old RECEIPT."""

    __tablename__ = "receipts"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    receipt_no: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    # The number printed on the paper voucher (legacy RECEIPT.MYFNO, or a
    # receipt book's). What the office and the client quote; not unique -
    # legacy numbering restarted - so receipt_no stays the key.
    ref_no: Mapped[str | None] = mapped_column(String(30), index=True)
    receipt_date: Mapped[date] = mapped_column(Date, nullable=False)
    client_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("clients.id"), nullable=False)
    contract_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("contracts.id"))
    cash_account_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("accounts.id"), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False)
    currency_id: Mapped[int] = mapped_column(SmallInteger, ForeignKey("currencies.id"), nullable=False)
    exchange_rate: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False, default=1, server_default="1")
    method: Mapped[PaymentMethod] = mapped_column(
        pg_enum(PaymentMethod, "payment_method"), nullable=False,
        default=PaymentMethod.cash, server_default="cash",
    )
    cheque_no: Mapped[str | None] = mapped_column(String(40))
    journal_entry_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("journal_entries.id"))
    notes: Mapped[str | None] = mapped_column(Text)

    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    deleted_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))

    __table_args__ = (
        Index("idx_receipts_client", "client_id"),
        Index("idx_receipts_contract", "contract_id"),
        Index("idx_receipts_date", "receipt_date"),
    )


class Payment(Base):
    """Payments (صرف) — money OUT. Mirrors old PAYMENT."""

    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    payment_no: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    ref_no: Mapped[str | None] = mapped_column(String(30), index=True)  # printed number, as on receipts
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    beneficiary_account_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("accounts.id"), nullable=False)
    contract_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("contracts.id"))
    cash_account_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("accounts.id"), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False)
    currency_id: Mapped[int] = mapped_column(SmallInteger, ForeignKey("currencies.id"), nullable=False)
    exchange_rate: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False, default=1, server_default="1")
    method: Mapped[PaymentMethod] = mapped_column(
        pg_enum(PaymentMethod, "payment_method"), nullable=False,
        default=PaymentMethod.cash, server_default="cash",
    )
    cheque_no: Mapped[str | None] = mapped_column(String(40))
    journal_entry_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("journal_entries.id"))
    notes: Mapped[str | None] = mapped_column(Text)

    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    deleted_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))

    __table_args__ = (Index("idx_payments_date", "payment_date"),)
