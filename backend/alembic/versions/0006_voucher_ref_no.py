"""Printed voucher number on receipts and payments.

The legacy import keyed documents by the old system's internal record id
(RECEIPT.FNO -> LEG-R-5103), but the paper voucher - and every legacy
statement - carries MYFNO (992). ref_no holds that printed number; it is not
unique (legacy numbering restarted), so receipt_no / payment_no stay the keys.

Revision ID: 0006
Revises: 0005
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('receipts', sa.Column('ref_no', sa.String(length=30), nullable=True))
    op.create_index(op.f('ix_receipts_ref_no'), 'receipts', ['ref_no'], unique=False)
    op.add_column('payments', sa.Column('ref_no', sa.String(length=30), nullable=True))
    op.create_index(op.f('ix_payments_ref_no'), 'payments', ['ref_no'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_payments_ref_no'), table_name='payments')
    op.drop_column('payments', 'ref_no')
    op.drop_index(op.f('ix_receipts_ref_no'), table_name='receipts')
    op.drop_column('receipts', 'ref_no')
