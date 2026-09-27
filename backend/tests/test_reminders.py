"""The monthly payment reminder (التنبيهات): a client who owes and has not paid
in the month turns late from the configured alert day, and a receipt clears it."""

from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import Account, Currency
from app.services.reminders import cycle_for


@pytest.fixture
def usd_id(db) -> int:
    return db.scalars(select(Currency.id).where(Currency.code == "USD")).one()


@pytest.fixture
def cash_account_id(db) -> int:
    return db.scalars(select(Account.id).where(Account.code == "1110")).one()


@pytest.fixture
def revenue_id(db) -> int:
    return db.scalars(select(Account.id).where(Account.code == "5110")).one()


def _owes(client: TestClient, auth, usd_id: int, revenue_id: int, name: str, amount: str = "12000.00", **extra) -> dict:
    """A client with a receivable balance and no payment schedule: a posted
    journal entry charging their account, as the imported ledger has."""
    person = client.post("/api/clients", headers=auth, json={"name_ar": name, **extra}).json()
    entry = client.post(
        "/api/journal",
        headers=auth,
        json={
            "entry_date": "2026-01-01",
            "entry_type": "sale",
            "currency_id": usd_id,
            "is_posted": True,
            "lines": [
                {"account_id": person["account_id"], "debit": amount},
                {"account_id": revenue_id, "credit": amount},
            ],
        },
    )
    assert entry.status_code == 201, entry.text
    return person


def _owing_client(client: TestClient, auth, usd_id: int, name: str, contract_no: str, **extra) -> dict:
    person = client.post("/api/clients", headers=auth, json={"name_ar": name, **extra}).json()
    building = client.post("/api/buildings", headers=auth, json={"name": f"برج {contract_no}"}).json()
    unit = client.post("/api/apartments", headers=auth, json={"building_id": building["id"], "unit_no": "1"}).json()
    contract = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": contract_no,
            "contract_type": "sale",
            "client_id": person["id"],
            "apartment_id": unit["id"],
            "currency_id": usd_id,
            "sign_date": "2026-01-01",
            "start_date": "2026-01-01",
            "total_amount": "12000.00",
            "installment_count": 12,
        },
    ).json()
    assert client.post(f"/api/contracts/{contract['id']}/activate", headers=auth).status_code == 200
    return person


def _pay(client: TestClient, auth, usd_id: int, cash_id: int, client_id: int, day: str, amount: str) -> dict:
    receipt = client.post(
        "/api/receipts",
        headers=auth,
        json={"receipt_date": day, "client_id": client_id, "cash_account_id": cash_id, "amount": amount, "currency_id": usd_id},
    )
    assert receipt.status_code == 201, receipt.text
    return receipt.json()


def _late(client: TestClient, auth, as_of: str) -> dict[int, dict]:
    report = client.get("/api/alerts", params={"as_of": as_of}, headers=auth).json()
    return {row["client_id"]: row for row in report["rows"]}


def test_cycle_opens_on_the_alert_day() -> None:
    before = cycle_for(date(2026, 3, 2), 3)
    assert (before.period, before.alert_date, before.next_alert_date) == ("2026-02", date(2026, 2, 3), date(2026, 3, 3))
    on = cycle_for(date(2026, 3, 3), 3)
    assert (on.period, on.is_alert_day) == ("2026-03", True)
    january = cycle_for(date(2026, 1, 1), 5)
    assert january.period == "2025-12"


def test_unpaid_month_is_late_and_a_receipt_clears_it(
    client: TestClient, auth, usd_id: int, cash_account_id: int, revenue_id: int
) -> None:
    client.put("/api/alerts/settings", headers=auth, json={"alert_day": 3, "enabled": True})
    owes = _owes(client, auth, usd_id, revenue_id, "عميل متأخر")
    _pay(client, auth, usd_id, cash_account_id, owes["id"], "2026-02-10", "1000.00")

    # March 2: the February cycle is in force, and February was paid.
    assert owes["id"] not in _late(client, auth, "2026-03-02")
    # March 3: the March cycle opens — nothing paid in March yet.
    row = _late(client, auth, "2026-03-03")[owes["id"]]
    assert row["reason"] == "no_payment" and row["months_unpaid"] == 1
    assert Decimal(row["balance"]) == Decimal("11000.00")

    receipt = _pay(client, auth, usd_id, cash_account_id, owes["id"], "2026-03-04", "1000.00")
    assert owes["id"] not in _late(client, auth, "2026-03-05")
    # Voiding the receipt brings the alert back.
    client.delete(f"/api/receipts/{receipt['id']}", headers=auth)
    assert owes["id"] in _late(client, auth, "2026-03-05")


def test_installment_short_payment_and_minimum_balance(
    client: TestClient, auth, usd_id: int, cash_account_id: int, revenue_id: int
) -> None:
    client.put("/api/alerts/settings", headers=auth, json={"alert_day": 1, "min_balance": "0"})
    short = _owes(client, auth, usd_id, revenue_id, "عميل ناقص", monthly_installment="1500.00")
    _pay(client, auth, usd_id, cash_account_id, short["id"], "2026-04-02", "500.00")
    row = _late(client, auth, "2026-04-10")[short["id"]]
    assert row["reason"] == "short" and Decimal(row["paid_this_cycle"]) == Decimal("500.00")
    assert row["months_unpaid"] == 0

    # Below the minimum balance nobody is chased.
    client.put("/api/alerts/settings", headers=auth, json={"min_balance": "20000"})
    assert short["id"] not in _late(client, auth, "2026-04-10")

    # Switched off, the list is empty.
    client.put("/api/alerts/settings", headers=auth, json={"min_balance": "0", "enabled": False})
    assert client.get("/api/alerts", params={"as_of": "2026-04-10"}, headers=auth).json()["count"] == 0


def test_reminder_marks_list_flags_and_permissions(
    client: TestClient, auth, usd_id: int, cash_account_id: int, revenue_id: int
) -> None:
    client.put("/api/alerts/settings", headers=auth, json={"alert_day": 1, "enabled": True})
    owes = _owes(client, auth, usd_id, revenue_id, "عميل للتذكير")
    today = date.today().isoformat()

    assert client.post(f"/api/alerts/clients/{owes['id']}/remind", headers=auth, json={"note": "اتصلنا"}).status_code == 200
    row = _late(client, auth, today)[owes["id"]]
    assert row["reminded_by"] == "tester" and row["reminder_note"] == "اتصلنا"
    assert client.get("/api/alerts/summary", headers=auth).json()["reminded_count"] >= 1
    client.delete(f"/api/alerts/clients/{owes['id']}/remind", headers=auth)
    assert _late(client, auth, today)[owes["id"]]["reminded_at"] is None

    # The clients list carries the red flag.
    items = client.get("/api/clients", headers=auth).json()["items"]
    assert next(i for i in items if i["id"] == owes["id"])["late"] is True
    # One client's status, for the statement banner.
    assert client.get(f"/api/alerts/clients/{owes['id']}", headers=auth).json()["client_id"] == owes["id"]

    # Viewers see alerts but cannot configure them or mark reminders.
    viewer_role = next(r["id"] for r in client.get("/api/roles", headers=auth).json() if r["code"] == "viewer")
    client.post("/api/users", headers=auth, json={"username": "look", "password": "secret123", "role_id": viewer_role})
    token = client.post("/api/auth/login", data={"username": "look", "password": "secret123"}).json()["access_token"]
    viewer = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/alerts", headers=viewer).status_code == 200
    assert client.put("/api/alerts/settings", headers=viewer, json={"alert_day": 9}).status_code == 403
    assert client.post(f"/api/alerts/clients/{owes['id']}/remind", headers=viewer, json={}).status_code == 403
    # The day must exist in every month.
    assert client.put("/api/alerts/settings", headers=auth, json={"alert_day": 31}).status_code == 422


def test_overdue_contract_installment_is_late_even_after_a_receipt(
    client: TestClient, auth, usd_id: int, cash_account_id: int
) -> None:
    """With a schedule, the installments decide: a receipt that only covers
    January leaves February's installment overdue in March."""
    client.put("/api/alerts/settings", headers=auth, json={"alert_day": 3, "enabled": True})
    owes = _owing_client(client, auth, usd_id, "عميل بعقد", "SALE-SCHED")
    _pay(client, auth, usd_id, cash_account_id, owes["id"], "2026-03-03", "1000.00")
    row = _late(client, auth, "2026-03-05")[owes["id"]]
    assert row["reason"] == "overdue_installment" and row["overdue_installments"] >= 1
