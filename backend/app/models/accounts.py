from datetime import datetime

from sqlalchemy import BigInteger, Boolean, ForeignKey, Identity, Index, SmallInteger, String, text
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AccountType, Base, pg_enum


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    code: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    name_ar: Mapped[str] = mapped_column(String(200), nullable=False)
    name_en: Mapped[str | None] = mapped_column(String(200))
    parent_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("accounts.id"))
    account_type: Mapped[AccountType] = mapped_column(pg_enum(AccountType, "account_type"), nullable=False)
    is_client: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    is_cash_bank: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    is_postable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    currency_id: Mapped[int | None] = mapped_column(SmallInteger, ForeignKey("currencies.id"))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default="now()")

    parent: Mapped["Account | None"] = relationship("Account", remote_side=[id], backref="children")

    __table_args__ = (
        Index("idx_accounts_parent", "parent_id"),
        Index("idx_accounts_client", "is_client", postgresql_where=text("is_client")),
    )
