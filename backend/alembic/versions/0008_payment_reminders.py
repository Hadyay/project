"""Monthly payment reminders: settings, per-client installment, reminder marks.

- alert_settings: one row (on, day 1, no minimum) — the day of the month from
  which clients who have not paid are flagged late.
- clients.monthly_installment: the expected monthly payment, optional.
- client_reminders: the office's "reminded" mark per client per month.
- New permissions alerts.view / alerts.manage / settings.alerts are added to
  the starting roles as the catalog's defaults give them (accountant: all
  three; sales, viewer: view). Custom roles are left for the administrator.

Revision ID: 0008
Revises: 0007
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

GRANTS = {
    "accountant": ["alerts.view", "alerts.manage", "settings.alerts"],
    "sales": ["alerts.view"],
    "viewer": ["alerts.view"],
}


def upgrade() -> None:
    op.create_table(
        "alert_settings",
        sa.Column("id", sa.SmallInteger(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("alert_day", sa.SmallInteger(), server_default="1", nullable=False),
        sa.Column("min_balance", sa.Numeric(precision=14, scale=2), server_default="0", nullable=False),
        sa.Column("updated_at", postgresql.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.CheckConstraint("id = 1", name="alert_settings_single_row"),
        sa.CheckConstraint("alert_day BETWEEN 1 AND 28", name="alert_settings_day_range"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute("INSERT INTO alert_settings (id) VALUES (1)")

    op.create_table(
        "client_reminders",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("client_id", sa.BigInteger(), nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("reminded_at", postgresql.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("reminded_by", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["reminded_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_id", "period", name="client_reminders_client_period"),
    )

    op.add_column("clients", sa.Column("monthly_installment", sa.Numeric(precision=14, scale=2), nullable=True))

    for code, perms in GRANTS.items():
        for perm in perms:
            op.execute(
                sa.text(
                    "UPDATE roles SET permissions = permissions || to_jsonb(CAST(:p AS text)) "
                    "WHERE code = :c AND NOT permissions ? :p"
                ).bindparams(p=perm, c=code)
            )


def downgrade() -> None:
    for code, perms in GRANTS.items():
        for perm in perms:
            op.execute(sa.text("UPDATE roles SET permissions = permissions - :p WHERE code = :c").bindparams(p=perm, c=code))
    op.drop_column("clients", "monthly_installment")
    op.drop_table("client_reminders")
    op.drop_table("alert_settings")
