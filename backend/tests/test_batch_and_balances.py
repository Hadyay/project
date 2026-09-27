"""Batch rent invoicing, the written overdue status, and balances on the client list."""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.models import Account, Currency, EntryType, JournalEntry

pytestmark = pytest.mark.usefixtures("db")


@pytest.fixture
def usd_id(db) -> int:
    return db.scalars(select(Currency.id).where(Currency.code == "USD")).one()


@pytest.fixture
def cash_account_id(db) -> int:
    return db.scalars(select(Account.id).where(Account.code == "1110")).one()


def _unit(client: TestClient, auth, building: str, unit_no: str) -> int:
    b = client.post("/api/buildings", headers=auth, json={"name": building}).json()
    return client.post(
        "/api/apartments", headers=auth, json={"building_id": b["id"], "unit_no": unit_no}
    ).json()["id"]


def _person(client: TestClient, auth, name: str) -> dict:
    return client.post("/api/clients", headers=auth, json={"name_ar": name}).json()


def _rent_invoices(db, contract_id: int) -> int:
    return db.scalar(
        select(func.count()).select_from(JournalEntry).where(
            JournalEntry.contract_id == contract_id,
            JournalEntry.entry_type == EntryType.rent_invoice,
            ~JournalEntry.is_deleted,
        )
    )


def test_batch_rent_invoicing_posts_each_due_period_once(
    client: TestClient, auth, db, usd_id: int
) -> None:
    tenant = _person(client, auth, "مستأجر الدفعة")
    lease = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": "RENT-BATCH",
            "contract_type": "rent",
            "client_id": tenant["id"],
            "apartment_id": _unit(client, auth, "برج الإيجار", "R1"),
            "currency_id": usd_id,
            "start_date": "2026-01-01",
            "end_date": "2026-06-30",
            "monthly_rent": "500.00",
        },
    ).json()
    # A draft lease is not binding yet and must not be invoiced.
    draft = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": "RENT-DRAFT",
            "contract_type": "rent",
            "client_id": tenant["id"],
            "apartment_id": _unit(client, auth, "برج المسودة", "R2"),
            "currency_id": usd_id,
            "start_date": "2026-01-01",
            "end_date": "2026-06-30",
            "monthly_rent": "700.00",
        },
    ).json()
    assert client.post(f"/api/contracts/{lease['id']}/activate", headers=auth).status_code == 200

    # Periods fall due on the 1st: Jan, Feb, Mar are due by the 15th of March.
    first = client.post("/api/contracts/rent/invoice-due", params={"as_of": "2026-03-15"}, headers=auth)
    assert first.status_code == 200, first.text
    assert (first.json()["invoiced"], first.json()["skipped"], first.json()["failures"]) == (3, 0, [])

    again = client.post("/api/contracts/rent/invoice-due", params={"as_of": "2026-03-15"}, headers=auth).json()
    assert (again["invoiced"], again["skipped"]) == (0, 3)

    later = client.post("/api/contracts/rent/invoice-due", params={"as_of": "2026-04-01"}, headers=auth).json()
    assert (later["invoiced"], later["skipped"]) == (1, 3)

    assert _rent_invoices(db, lease["id"]) == 4
    assert _rent_invoices(db, draft["id"]) == 0

    # The single-period endpoint shares the guard.
    schedule = client.get(f"/api/contracts/{lease['id']}/schedule", headers=auth).json()
    dup = client.post(f"/api/contracts/{lease['id']}/schedule/{schedule[0]['id']}/invoice", headers=auth)
    assert dup.status_code == 409

    listed = client.get("/api/clients", params={"q": "مستأجر الدفعة"}, headers=auth).json()["items"]
    assert Decimal(listed[0]["balance_base"]) == Decimal("2000.00")


def test_refresh_overdue_writes_the_status_and_takes_it_back(
    client: TestClient, auth, usd_id: int, cash_account_id: int
) -> None:
    buyer = _person(client, auth, "مشتري الأقساط")
    contract = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": "SALE-LATE",
            "contract_type": "sale",
            "client_id": buyer["id"],
            "apartment_id": _unit(client, auth, "برج الأقساط", "S1"),
            "currency_id": usd_id,
            "sign_date": "2026-01-10",
            "start_date": "2026-01-10",
            "total_amount": "4000.00",
            "installment_count": 4,  # due 02-10, 03-10, 04-10, 05-10
        },
    ).json()
    client.post(f"/api/contracts/{contract['id']}/activate", headers=auth)
    paid = client.post(
        "/api/receipts",
        headers=auth,
        json={
            "receipt_date": "2026-02-15",
            "client_id": buyer["id"],
            "contract_id": contract["id"],
            "cash_account_id": cash_account_id,
            "amount": "1500.00",
            "currency_id": usd_id,
        },
    )
    assert paid.status_code == 201, paid.text

    def statuses() -> list[str]:
        rows = client.get(f"/api/contracts/{contract['id']}/schedule", headers=auth).json()
        return [row["status"] for row in rows]

    assert statuses() == ["paid", "partial", "pending", "pending"]

    marked = client.post(
        "/api/contracts/schedule/refresh-overdue", params={"as_of": "2026-04-20"}, headers=auth
    ).json()
    assert (marked["marked_overdue"], marked["cleared"]) == (1, 0)
    # Part-paid keeps `partial`: it records that money arrived.
    assert statuses() == ["paid", "partial", "overdue", "pending"]

    # Replaying for an earlier date takes back what is no longer late.
    back = client.post(
        "/api/contracts/schedule/refresh-overdue", params={"as_of": "2026-03-01"}, headers=auth
    ).json()
    assert (back["marked_overdue"], back["cleared"]) == (0, 1)
    assert statuses() == ["paid", "partial", "pending", "pending"]


def test_client_list_filters_and_sorts_by_balance(
    client: TestClient, auth, usd_id: int, cash_account_id: int
) -> None:
    owes = _person(client, auth, "عميل مدين")
    ahead = _person(client, auth, "عميل دائن")
    settled = _person(client, auth, "عميل مسدد")

    contract = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": "SALE-BAL",
            "contract_type": "sale",
            "client_id": owes["id"],
            "apartment_id": _unit(client, auth, "برج الأرصدة", "B1"),
            "currency_id": usd_id,
            "sign_date": "2026-01-01",
            "start_date": "2026-01-01",
            "total_amount": "9000.00",
            "installment_count": 3,
        },
    ).json()
    client.post(f"/api/contracts/{contract['id']}/activate", headers=auth)

    advance = client.post(
        "/api/receipts",
        headers=auth,
        json={
            "receipt_date": "2026-01-05",
            "client_id": ahead["id"],
            "cash_account_id": cash_account_id,
            "amount": "300.00",
            "currency_id": usd_id,
        },
    )
    assert advance.status_code == 201, advance.text

    def names(**params) -> list[str]:
        page = client.get("/api/clients", params=params, headers=auth).json()
        return [item["name_ar"] for item in page["items"]]

    assert names(balance="debit") == ["عميل مدين"]
    assert names(balance="credit") == ["عميل دائن"]
    assert names(balance="zero") == ["عميل مسدد"]
    assert names(sort="balance_desc") == ["عميل مدين", "عميل مسدد", "عميل دائن"]

    items = {i["name_ar"]: Decimal(i["balance_base"]) for i in client.get("/api/clients", headers=auth).json()["items"]}
    assert items == {
        "عميل مدين": Decimal("9000.00"),
        "عميل دائن": Decimal("-300.00"),
        "عميل مسدد": Decimal("0"),
    }

    # A voided receipt leaves the balance — it must not keep counting.
    client.delete(f"/api/receipts/{advance.json()['id']}", headers=auth)
    assert names(balance="credit") == []


def test_client_balances_report_matches_the_ledger(
    client: TestClient, auth, usd_id: int, cash_account_id: int
) -> None:
    """كشف الأرصدة: per-client debit/credit/balance for a period, the property
    fields alongside, the dashboard's numbers agreeing, and a voided receipt
    leaving the totals (the trial-balance shape)."""
    owes = client.post(
        "/api/clients",
        headers=auth,
        json={"name_ar": "عميل الكشف", "phone": "70000000", "project": "الهدفة 432", "block": "بلوك B3", "floor_side": "اول غربي"},
    ).json()
    contract = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": "SALE-RPT",
            "contract_type": "sale",
            "client_id": owes["id"],
            "apartment_id": _unit(client, auth, "برج الكشف", "R1"),
            "currency_id": usd_id,
            "sign_date": "2026-01-01",
            "start_date": "2026-01-01",
            "total_amount": "5000.00",
            "installment_count": 1,
        },
    ).json()
    client.post(f"/api/contracts/{contract['id']}/activate", headers=auth)
    receipt = client.post(
        "/api/receipts",
        headers=auth,
        json={
            "receipt_date": "2026-02-01",
            "client_id": owes["id"],
            "cash_account_id": cash_account_id,
            "amount": "1200.00",
            "currency_id": usd_id,
            "ref_no": "992",
        },
    )
    assert receipt.status_code == 201, receipt.text
    assert receipt.json()["ref_no"] == "992"

    def report(**params) -> dict:
        return client.get("/api/reports/client-balances", params=params, headers=auth).json()

    row = next(r for r in report()["rows"] if r["client_id"] == owes["id"])
    assert (Decimal(row["debit"]), Decimal(row["credit"]), Decimal(row["balance"])) == (
        Decimal("5000.00"),
        Decimal("1200.00"),
        Decimal("3800.00"),
    )
    assert (row["phone"], row["project"], row["block"], row["floor_side"]) == ("70000000", "الهدفة 432", "بلوك B3", "اول غربي")
    assert row["currency"]  # falls back to the base currency's name

    # A period narrows the sums; the search reaches project and block.
    january = next(r for r in report(date_to="2026-01-31")["rows"] if r["client_id"] == owes["id"])
    assert Decimal(january["credit"]) == 0
    assert [r["client_id"] for r in report(q="B3")["rows"]] == [owes["id"]]

    # The statement quotes the printed voucher number, not the system one.
    statement = client.get(f"/api/clients/{owes['id']}/statement", headers=auth).json()
    assert "992" in [line["document_no"] for line in statement["lines"]]

    dashboard = client.get("/api/reports/dashboard", headers=auth).json()
    assert dashboard["debtors_count"] >= 1
    assert any(d["client_id"] == owes["id"] for d in dashboard["top_debtors"])
    assert dashboard["recent_receipts"][0]["ref_no"] == "992"

    # Voiding the receipt takes it out of the report.
    client.delete(f"/api/receipts/{receipt.json()['id']}", headers=auth)
    row = next(r for r in report()["rows"] if r["client_id"] == owes["id"])
    assert Decimal(row["credit"]) == 0 and Decimal(row["balance"]) == Decimal("5000.00")
