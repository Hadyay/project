"""Client property details: project, block, floor/side.

The legacy customer card (ACCOUNTMAP) carried where each client bought -
المشروع والعقار, بلوك, طابق / جهة - and every legacy balance report prints
them. They are free text on the client, not a unit register.

Revision ID: 0005
Revises: 0004
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('clients', sa.Column('project', sa.String(length=100), nullable=True))
    op.add_column('clients', sa.Column('block', sa.String(length=40), nullable=True))
    op.add_column('clients', sa.Column('floor_side', sa.String(length=60), nullable=True))


def downgrade() -> None:
    op.drop_column('clients', 'floor_side')
    op.drop_column('clients', 'block')
    op.drop_column('clients', 'project')
