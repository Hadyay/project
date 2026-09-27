"""The collection rule shared by the reminders, the dashboard ring and
جدول الدفعات: owing = owed at the start of the month; paid / short / unpaid."""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import Account, Currency


@pytest.fixture
def usd_id(db) -> int:
    return db.scalars(select(Currency.id).where(Currency.code == "USD")).one()


@pytest.fixture
def cash_account_id(db) -> int:
    return db.scalars(select(Account.id).where(Account.code == "1110")).one()


@pytest.fixture
def revenue_id(db) -> int:
    return db.scalars(select(Account.id).where(Account.code == "5110")).one()


def _charge(client: TestClient, auth, usd_id: int, revenue_id: int, name: str, day: str, amount: str = "12000.00", **extra) -> dict:
    person = client.post("/api/clients", headers=auth, json={"name_ar": name, **extra}).json()
    entry = client.post(
        "/api/journal",
        headers=auth,
        json={
            "entry_date": day,
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


def _pay(client: TestClient, auth, usd_id: int, cash_id: int, client_id: int, day: str, amount: str) -> None:
    r = client.post(
        "/api/receipts",
        headers=auth,
        json={"receipt_date": day, "client_id": client_id, "cash_account_id": cash_id, "amount": amount, "currency_id": usd_id},
    )
    assert r.status_code == 201, r.text


def test_a_client_is_not_late_in_the_month_they_bought(
    client: TestClient, auth, usd_id: int, revenue_id: int
) -> None:
    client.put("/api/alerts/settings", headers=auth, json={"alert_day": 1, "enabled": True, "min_balance": "0"})
    buyer = _charge(client, auth, usd_id, revenue_id, "مشترٍ جديد", "2026-03-15")

    march = client.get("/api/alerts", params={"as_of": "2026-03-20"}, headers=auth).json()
    assert buyer["id"] not in {r["client_id"] for r in march["rows"]}
    april = client.get("/api/alerts", params={"as_of": "2026-04-02"}, headers=auth).json()
    assert buyer["id"] in {r["client_id"] for r in april["rows"]}


def test_collection_rate_and_the_alerts_agree(
    client: TestClient, auth, usd_id: int, cash_account_id: int, revenue_id: int
) -> None:
    client.put("/api/alerts/settings", headers=auth, json={"alert_day": 1, "enabled": True, "min_balance": "0"})
    a = _charge(client, auth, usd_id, revenue_id, "يدفع", "2026-01-10")
    b = _charge(client, auth, usd_id, revenue_id, "لا يدفع", "2026-01-10")
    c = _charge(client, auth, usd_id, revenue_id, "قسط ناقص", "2026-01-10", monthly_installment="1000.00")
    _charge(client, auth, usd_id, revenue_id, "اشترى هذا الشهر", "2026-03-05")
    _pay(client, auth, usd_id, cash_account_id, a["id"], "2026-03-03", "500.00")
    _pay(client, auth, usd_id, cash_account_id, c["id"], "2026-03-04", "400.00")
    _pay(client, auth, usd_id, cash_account_id, b["id"], "2026-02-20", "700.00")

    report = client.get("/api/reports/collection", params={"as_of": "2026-03-20", "months": 3}, headers=auth).json()
    assert [m["period"] for m in report["months"]] == ["2026-01", "2026-02", "2026-03"]
    march = report["current"]
    # Owed on March 1: a, b, c (the March buyer did not). Paid: only a.
    assert (march["owing_at_start"], march["paid"], march["late"]) == (3, 1, 2)
    assert Decimal(march["rate"]) == Decimal("33.33")
    assert Decimal(march["amount_collected"]) == Decimal("900.00")
    assert Decimal(march["expected"]) == Decimal("1000.00")
    february = report["months"][1]
    assert (february["owing_at_start"], february["paid"]) == (3, 1)  # b paid in February
    assert report["months"][0]["owing_at_start"] == 0  # nobody owed on January 1
    assert Decimal(report["months"][0]["rate"]) == 0

    alerts = client.get("/api/alerts", params={"as_of": "2026-03-20"}, headers=auth).json()
    assert alerts["count"] == march["late"]
    assert {r["client_id"] for r in alerts["rows"]} == {b["id"], c["id"]}


def test_payment_grid(client: TestClient, auth, usd_id: int, cash_account_id: int, revenue_id: int) -> None:
    client.put("/api/alerts/settings", headers=auth, json={"alert_day": 1, "enabled": True, "min_balance": "0"})
    person = _charge(client, auth, usd_id, revenue_id, "صاحب الجدول", "2026-02-10", monthly_installment="1000.00", project="الهدفة 432")
    _pay(client, auth, usd_id, cash_account_id, person["id"], "2026-03-05", "1000.00")
    _pay(client, auth, usd_id, cash_account_id, person["id"], "2026-04-05", "300.00")
    _charge(client, auth, usd_id, revenue_id, "آخر", "2026-02-10")

    grid = client.get("/api/schedule/grid", params={"year": 2026, "as_of": "2026-06-15"}, headers=auth).json()
    assert grid["months"][0] == "2026-01" and len(grid["months"]) == 12
    assert grid["projects"] == ["الهدفة 432"]
    row = next(r for r in grid["rows"] if r["client_id"] == person["id"])
    statuses = [c["status"] for c in row["cells"]]
    # Jan before the first charge · Feb bought that month · Mar paid · Apr short · May, Jun unpaid · rest future.
    assert statuses[:6] == ["before", "settled", "paid", "short", "unpaid", "unpaid"]
    assert set(statuses[6:]) == {"future"}
    assert Decimal(row["total_paid"]) == Decimal("1300.00") and row["late"] is True and row["late_months"] == 3
    assert row["first_charge_date"] == "2026-02-10"

    march = next(t for t in grid["totals"] if t["period"] == "2026-03")
    assert (march["paid_clients"], march["owing_clients"], Decimal(march["rate"])) == (1, 2, Decimal("50.00"))
    assert Decimal(march["paid_amount"]) == Decimal("1000.00")

    # Filters: search (Arabic-folded), project, late only.
    assert [r["client_id"] for r in client.get("/api/schedule/grid", params={"year": 2026, "as_of": "2026-06-15", "q": "صاحب"}, headers=auth).json()["rows"]] == [person["id"]]
    assert len(client.get("/api/schedule/grid", params={"year": 2026, "as_of": "2026-06-15", "project": "الهدفة 432"}, headers=auth).json()["rows"]) == 1
    assert len(client.get("/api/schedule/grid", params={"year": 2026, "as_of": "2026-06-15", "only_late": True}, headers=auth).json()["rows"]) == 2
    # A year before anything happened: the clients who owe today are listed,
    # every month grey "before" (never red), and no month has anyone owing.
    earlier = client.get("/api/schedule/grid", params={"year": 2025, "as_of": "2026-06-15"}, headers=auth).json()
    assert earlier["rows"] and all(c["status"] == "before" for r in earlier["rows"] for c in r["cells"])
    assert all(t["owing_clients"] == 0 for t in earlier["totals"])


def test_grid_and_collection_permissions(client: TestClient, auth) -> None:
    roles = {r["code"]: r["id"] for r in client.get("/api/roles", headers=auth).json()}
    empty = client.post("/api/roles", headers=auth, json={"code": "nothing", "name": "لا شيء", "permissions": []}).json()
    client.post("/api/users", headers=auth, json={"username": "noone", "password": "secret123", "role_id": empty["id"]})
    client.post("/api/users", headers=auth, json={"username": "viewer1", "password": "secret123", "role_id": roles["viewer"]})

    def login(user: str) -> dict:
        token = client.post("/api/auth/login", data={"username": user, "password": "secret123"}).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    nobody, viewer = login("noone"), login("viewer1")
    assert client.get("/api/schedule/grid", headers=nobody).status_code == 403
    assert client.get("/api/reports/collection", headers=nobody).status_code == 403
    assert client.get("/api/schedule/grid", headers=viewer).status_code == 200
    assert client.get("/api/reports/collection", headers=viewer).status_code == 200
