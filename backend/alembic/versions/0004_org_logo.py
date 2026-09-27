"""Letterhead logo, stored inline as a data URI.

It lives in the row so a pg_dump carries it: a backup that loses the
letterhead is a backup that cannot reprint last year's receipts.

Revision ID: 0004
Revises: 0003
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('org_settings', sa.Column('logo', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('org_settings', 'logo')
