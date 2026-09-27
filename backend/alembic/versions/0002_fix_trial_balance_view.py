"""Fix v_trial_balance: a voided entry's lines were still counted.

The view joined journal_entries with LEFT JOIN … AND NOT je.is_deleted. An
outer join does not drop the row — it only nulls the entry columns — so the
line's debit_base and credit_base kept flowing into the sums after its entry
was soft-deleted. Both sides moved together, so the balance still balanced and
nothing looked wrong; the totals were simply too big.

The line filter belongs in a subquery with an inner join. The join back to
accounts stays outer so that accounts with no movement still appear at zero.

`app/api/accounts.py::trial_balance` had the same shape and is fixed with it.

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FIXED = """
CREATE VIEW v_trial_balance AS
SELECT
    a.id AS account_id, a.code, a.name_ar,
    COALESCE(sum(m.debit_base),0)  AS total_debit,
    COALESCE(sum(m.credit_base),0) AS total_credit,
    COALESCE(sum(m.debit_base - m.credit_base),0) AS balance
FROM accounts a
LEFT JOIN (
    SELECT jl.account_id, jl.debit_base, jl.credit_base
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    WHERE NOT je.is_deleted
) m ON m.account_id = a.id
GROUP BY a.id, a.code, a.name_ar;
"""

ORIGINAL = """
CREATE VIEW v_trial_balance AS
SELECT
    a.id AS account_id, a.code, a.name_ar,
    COALESCE(sum(jl.debit_base),0)  AS total_debit,
    COALESCE(sum(jl.credit_base),0) AS total_credit,
    COALESCE(sum(jl.debit_base - jl.credit_base),0) AS balance
FROM accounts a
LEFT JOIN journal_lines jl   ON jl.account_id = a.id
LEFT JOIN journal_entries je ON je.id = jl.entry_id AND NOT je.is_deleted
GROUP BY a.id, a.code, a.name_ar;
"""


def upgrade() -> None:
    op.execute("DROP VIEW IF EXISTS v_trial_balance")
    op.execute(FIXED)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS v_trial_balance")
    op.execute(ORIGINAL)
