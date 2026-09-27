"""Tests for the legacy CSV import.

The parsing and reconciliation half needs no database, so it runs everywhere.
The two tests that read `legacy_data/` skip when the folder is absent — it is
gitignored, being the client's real ledger.
"""

from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models import Account, Client, JournalEntry, JournalLine, Receipt
from app.seed import legacy_import
from app.seed.legacy_import import PlannedLine, Table
from tests.conftest import requires_db

LEGACY_DIR = Path(__file__).resolve().parents[2] / "legacy_data"

requires_legacy_data = pytest.mark.skipif(
    not (LEGACY_DIR / "MIZAN.csv").exists(), reason=f"No legacy CSVs in {LEGACY_DIR}"
)


def line(debit="0", credit="0", debit_base=None, credit_base=None) -> PlannedLine:
    return PlannedLine(
        account_code="1110",
        client_code=None,
        debit=Decimal(debit),
        credit=Decimal(credit),
        debit_base=Decimal(debit_base if debit_base is not None else debit),
        credit_base=Decimal(credit_base if credit_base is not None else credit),
        line_desc=None,
    )


# ----------------------------------------------------------------- unit tests


def test_balance_base_shaves_the_largest_debit():
    lines = [line(debit="60.01"), line(debit="10.00"), line(credit="70.00")]
    legacy_import.balance_base(lines)
    assert [l.debit_base for l in lines[:2]] == [Decimal("60.00"), Decimal("10.00")]
    assert lines[2].credit_base == Decimal("70.00")


def test_balance_base_shaves_the_largest_credit():
    lines = [line(debit="69.99"), line(credit="60.00"), line(credit="10.00")]
    legacy_import.balance_base(lines)
    assert [l.credit_base for l in lines[1:]] == [Decimal("59.99"), Decimal("10.00")]
    assert lines[0].debit_base == Decimal("69.99")


def test_balance_base_leaves_a_balanced_entry_alone():
    lines = [line(debit="42.00"), line(credit="42.00")]
    legacy_import.balance_base(lines)
    assert [l.debit_base for l in lines] == [Decimal("42.00"), Decimal("0")]


def test_table_rejects_a_shifted_header(tmp_path):
    path = tmp_path / "JOURNAL.csv"
    path.write_text("JID,FDATE,DESCR\n1,5-JUL-2019,قبض\n", encoding="utf-8-sig")
    with pytest.raises(SystemExit, match="expected column 1 to be 'DESCR'"):
        Table(path, ("JID", "DESCR", "FDATE"))


def test_row_reads_dates_amounts_and_nulls(tmp_path):
    path = tmp_path / "JOURNAL.csv"
    path.write_text("JID,FDATE,DESCR\n7,15-DEC-2021,<null>\n", encoding="utf-8-sig")
    row = next(iter(Table(path, ("JID", "FDATE", "DESCR"))))
    assert row.date("FDATE").isoformat() == "2021-12-15"
    assert row.text("DESCR") is None
    assert row.dec("JID") == Decimal(7)


def test_rate_to_base_inverts_currval(tmp_path):
    path = tmp_path / "SCURRENCY.csv"
    path.write_text("CURRID,CURRNAME,CURRVAL\n1,ليرة,1500.0\n", encoding="utf-8-sig")
    row = next(iter(Table(path, ("CURRID", "CURRNAME", "CURRVAL"))))
    # CURRVAL counts LBP per USD; the schema stores USD per LBP
    assert legacy_import.rate_to_base(row) == Decimal("0.000667")


# ------------------------------------------------------- against the real CSVs


@pytest.fixture(scope="module")
def plan():
    return legacy_import.build_plan(legacy_import.read_all(LEGACY_DIR))


@requires_legacy_data
def test_the_plan_reconciles_with_the_legacy_trial_balance(plan):
    tables = legacy_import.read_all(LEGACY_DIR)
    assert legacy_import.reconcile(plan, tables["MIZAN"]) == []
    assert plan.errors == []

    totals = legacy_import.totals_by_account(plan)
    debit = sum((d for d, _ in totals.values()), Decimal(0))
    credit = sum((c for _, c in totals.values()), Decimal(0))
    assert debit == credit
    # every entry balances on its own, not merely in aggregate
    for entry in plan.entries:
        assert sum((l.debit_base for l in entry.lines), Decimal(0)) == sum(
            (l.credit_base for l in entry.lines), Decimal(0)
        ), entry.entry_no


@requires_legacy_data
@requires_db
def test_write_imports_and_is_idempotent(db, plan):
    first = legacy_import.write(plan, db)
    db.flush()
    assert first["entries"] == len(plan.entries)
    assert first["clients"] == len(plan.clients)

    # the starter chart is already seeded, so only the legacy codes are new
    assert db.scalar(select(Account).where(Account.code == "5300002")) is not None
    assert db.scalar(select(Account).where(Account.code == "1110")) is not None

    lines = db.scalars(select(JournalLine)).all()
    assert sum(l.debit_base for l in lines) == sum(l.credit_base for l in lines)

    # client lines carry the client, so the statement screen has something to show
    client = db.scalars(select(Client).where(Client.code == "41100001")).one()
    client_lines = db.scalars(select(JournalLine).where(JournalLine.client_id == client.id)).all()
    assert client_lines
    assert {l.account_id for l in client_lines} == {client.account_id}

    receipt = db.scalars(select(Receipt).where(Receipt.receipt_no == "LEG-R-24")).one()
    assert receipt.client_id == client.id
    assert receipt.journal_entry_id is not None

    second = legacy_import.write(plan, db)
    db.flush()
    assert set(second.values()) == {0}
    assert len(db.scalars(select(JournalEntry)).all()) == len(plan.entries)
