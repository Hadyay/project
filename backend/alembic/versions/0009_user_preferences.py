"""Per-user interface preferences (theme, language, simple mode).

Stored on the user rather than in a browser, so a person's choices follow
them to any PC. Defaults are filled by schemas.auth.Preferences, so existing
users start with '{}'.

Revision ID: 0009
Revises: 0008
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("preferences", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "preferences")
