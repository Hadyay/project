"""Dynamic roles: users get a role row instead of a fixed enum.

Roles become data - a name and a set of permission codes (see
app/core/permissions.py) that the administrator edits from الإعدادات. The four
fixed roles are carried over with exactly the rights they had, and every user
keeps their access. The system role ("admin") holds every permission and is
locked. The old `users.role` column and `user_role` enum type are dropped.

The permission lists below are a snapshot, deliberately not imported from the
app: a migration must keep meaning the same thing after the catalog changes.

Revision ID: 0007
Revises: 0006
"""
import json
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ACCOUNTANT = [
    "accounts.create", "accounts.edit", "accounts.view", "buildings.create", "buildings.delete",
    "buildings.edit", "buildings.view", "clients.create", "clients.delete", "clients.edit", "clients.view",
    "contracts.activate", "contracts.create", "contracts.delete", "contracts.edit", "contracts.view",
    "dashboard.view", "journal.create", "journal.post", "journal.view", "journal.void", "payments.create",
    "payments.view", "payments.void", "receipts.create", "receipts.view", "receipts.void", "reports.view",
    "schedule.manage", "schedule.view", "settings.rates", "units.create", "units.delete", "units.edit",
    "units.view",
]
_SALES = [
    "accounts.view", "buildings.create", "buildings.delete", "buildings.edit", "buildings.view",
    "clients.create", "clients.delete", "clients.edit", "clients.view", "contracts.create", "contracts.edit",
    "contracts.view", "dashboard.view", "journal.view", "payments.view", "receipts.view", "reports.view",
    "schedule.view", "units.create", "units.delete", "units.edit", "units.view",
]
_VIEWER = [
    "accounts.view", "buildings.view", "clients.view", "contracts.view", "dashboard.view", "journal.view",
    "payments.view", "receipts.view", "reports.view", "schedule.view", "units.view",
]
ROLES = [
    ("admin", "مدير النظام", "كل الصلاحيات — دور ثابت لا يُعدَّل ولا يُحذف.", [], True),
    ("accountant", "محاسب", "كل العمليات والقيود والتقارير، دون إدارة المستخدمين وبيانات المنشأة.", _ACCOUNTANT, False),
    ("sales", "مبيعات", "الأبنية والوحدات والعملاء والعقود، مع الاطلاع على الباقي.", _SALES, False),
    ("viewer", "مطالعة", "اطلاع فقط على كل الشاشات.", _VIEWER, False),
]


def upgrade() -> None:
    op.create_table(
        "roles",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("permissions", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
        sa.Column("is_system", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", postgresql.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", postgresql.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    roles = sa.table(
        "roles",
        sa.column("code", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.Text),
        sa.column("permissions", postgresql.JSONB),
        sa.column("is_system", sa.Boolean),
    )
    op.bulk_insert(
        roles,
        [
            {"code": c, "name": n, "description": d, "permissions": p, "is_system": s}
            for c, n, d, p, s in ROLES
        ],
    )

    op.add_column("users", sa.Column("role_id", sa.BigInteger(), nullable=True))
    # Every user keeps the access they had: old enum label -> role of that code.
    op.execute("UPDATE users SET role_id = roles.id FROM roles WHERE roles.code = users.role::text")
    op.alter_column("users", "role_id", nullable=False)
    op.create_foreign_key("users_role_id_fkey", "users", "roles", ["role_id"], ["id"])
    op.drop_column("users", "role")
    op.execute("DROP TYPE IF EXISTS user_role")


def downgrade() -> None:
    op.execute("CREATE TYPE user_role AS ENUM ('admin', 'accountant', 'sales', 'viewer')")
    op.add_column(
        "users",
        sa.Column(
            "role",
            postgresql.ENUM("admin", "accountant", "sales", "viewer", name="user_role", create_type=False),
            server_default="viewer",
            nullable=False,
        ),
    )
    # Custom roles have no enum label; their users fall back to viewer.
    op.execute(
        "UPDATE users SET role = CASE WHEN roles.code IN ('admin','accountant','sales','viewer') "
        "THEN roles.code::user_role ELSE 'viewer' END FROM roles WHERE roles.id = users.role_id"
    )
    op.drop_constraint("users_role_id_fkey", "users", type_="foreignkey")
    op.drop_column("users", "role_id")
    op.drop_table("roles")
