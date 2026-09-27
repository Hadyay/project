"""Organisation letterhead for printed documents.

One row, forced by a check constraint. Every voucher, statement and report
carries this heading, so it cannot live in the frontend bundle or a browser's
storage — two clerks printing the same receipt must produce the same paper.
The legacy system kept it in CONFIGS.csv for the same reason.

Revision ID: 0003
Revises: 0002
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('org_settings',
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('name', sa.String(length=150), nullable=False),
    sa.Column('subtitle', sa.String(length=150), nullable=True),
    sa.Column('address', sa.String(length=255), nullable=True),
    sa.Column('phone', sa.String(length=60), nullable=True),
    sa.Column('email', sa.String(length=120), nullable=True),
    sa.Column('tax_no', sa.String(length=60), nullable=True),
    sa.Column('footer_note', sa.String(length=255), nullable=True),
    sa.Column('updated_at', postgresql.TIMESTAMP(timezone=True), server_default='now()', nullable=False),
    sa.Column('updated_by', sa.BigInteger(), nullable=True),
    sa.CheckConstraint('id = 1', name='org_settings_single_row'),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('org_settings')
