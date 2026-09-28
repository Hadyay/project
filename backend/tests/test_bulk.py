"""Bulk operations: many receipts in one call, many reminders in one call."""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.models import Account, AuditLog, Currency, Receipt


@pytest.fixture
def usd_id(db) -> int:
    return db.scalars(select(Currency.id).where(Currency.code == "USD")).one()


@pytest.fixture
def cash_account_id(db) -> int:
    return db.scalars(select(Account.id).where(Account.code == "1110")).one()


def _sale(client: TestClient, auth, usd_id: int, name: str, unit_no: str) -> tuple[dict, dict]:
    """A client with an activated 12,000 sale in 12 installments of 1,000."""
    building = client.post("/api/buildings", headers=auth, json={"name": f"برج {unit_no}"}).json()
    unit = client.post("/api/apartments", headers=auth, json={"building_id": building["id"], "unit_no": unit_no}).json()
    buyer = client.post("/api/clients", headers=auth, json={"name_ar": name}).json()
    contract = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": f"SALE-{unit_no}",
            "contract_type": "sale",
            "client_id": buyer["id"],
            "apartment_id": unit["id"],
            "currency_id": usd_id,
            "sign_date": "2026-03-01",
            "start_date": "2026-03-01",
            "total_amount": "12000.00",
            "installment_count": 12,
        },
    ).json()
    assert client.post(f"/api/contracts/{contract['id']}/activate", headers=auth).status_code == 200
    return buyer, contract


def _bulk(client: TestClient, auth, usd_id: int, cash_id: int, lines: list[dict], **extra):
    return client.post(
        "/api/receipts/bulk",
        headers=auth,
        json={"receipt_date": "2026-04-05", "cash_account_id": cash_id, "currency_id": usd_id, "lines": lines, **extra},
    )


def test_bulk_receipts_post_allocate_and_report_failures(
    client: TestClient, auth, db, usd_id: int, cash_account_id: int
) -> None:
    a, contract_a = _sale(client, auth, usd_id, "أحمد", "A1")
    b, contract_b = _sale(client, auth, usd_id, "بلال", "B1")

    r = _bulk(client, auth, usd_id, cash_account_id, [
        {"client_id": a["id"], "amount": "2500.00", "contract_id": contract_a["id"], "ref_no": "901"},
        {"client_id": b["id"], "amount": "1000.00", "contract_id": contract_a["id"]},  # someone else's contract
        {"client_id": 999999, "amount": "50.00"},                                      # no such client
        {"client_id": b["id"], "amount": "1000.00", "notes": "دفعة نيسان"},
    ])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 2 and Decimal(body["total_amount"]) == Decimal("3500.00")
    assert [(c["line"], c["client_id"]) for c in body["created"]] == [(0, a["id"]), (3, b["id"])]
    assert [c["receipt_no"] for c in body["created"]] == ["REC-0001", "REC-0002"]
    assert [(f["line"], f["client_id"]) for f in body["failures"]] == [(1, b["id"]), (2, 999999)]
    assert body["failures"][0]["detail"] == "العقد لا يخص هذا العميل"

    # Each receipt went the single-receipt way: GL, allocation, audit.
    schedule = client.get(f"/api/contracts/{contract_a['id']}/schedule", headers=auth).json()
    assert [row["status"] for row in schedule[:4]] == ["paid", "paid", "partial", "pending"]
    assert Decimal(client.get(f"/api/clients/{a['id']}/balance", headers=auth).json()["balance"]) == Decimal("9500.00")
    assert Decimal(client.get(f"/api/clients/{b['id']}/balance", headers=auth).json()["balance"]) == Decimal("11000.00")
    receipt = client.get(f"/api/receipts/{body['created'][0]['receipt_id']}", headers=auth).json()
    assert receipt["ref_no"] == "901" and receipt["journal_entry_id"] is not None
    assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.table_name == "receipts")) == 2
    # The failed lines left nothing behind: no receipt, and b's contract untouched.
    assert db.scalar(select(func.count()).select_from(Receipt)) == 2
    assert client.get(f"/api/contracts/{contract_b['id']}/schedule", headers=auth).json()[0]["status"] == "pending"


def test_bulk_receipts_check_what_lines_share_before_writing(
    client: TestClient, auth, db, usd_id: int, cash_account_id: int
) -> None:
    person = client.post("/api/clients", headers=auth, json={"name_ar": "سامر"}).json()
    line = [{"client_id": person["id"], "amount": "100.00"}]
    revenue = db.scalars(select(Account.id).where(Account.code == "5110")).one()
    lbp = db.scalars(select(Currency.id).where(Currency.code == "LBP")).one()

    assert _bulk(client, auth, usd_id, revenue, line).status_code == 400           # not a till
    assert _bulk(client, auth, 9999, cash_account_id, line).status_code == 400     # no such currency
    no_rate = _bulk(client, auth, lbp, cash_account_id, line)                      # LBP, no rate yet
    assert no_rate.status_code == 400 and "exchange rate" in no_rate.json()["detail"]
    assert _bulk(client, auth, usd_id, cash_account_id, []).status_code == 422     # nothing to do
    assert db.scalar(select(func.count()).select_from(Receipt)) == 0


def test_bulk_remind(client: TestClient, auth) -> None:
    a = client.post("/api/clients", headers=auth, json={"name_ar": "أول"}).json()
    b = client.post("/api/clients", headers=auth, json={"name_ar": "ثان"}).json()

    r = client.post("/api/alerts/remind/bulk", headers=auth, json={"client_ids": [a["id"], b["id"], a["id"], 999999], "note": "اتصال هاتفي"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 2 and body["missing"] == [999999] and len(body["period"]) == 7
    # Re-running updates the marks rather than duplicating them.
    again = client.post("/api/alerts/remind/bulk", headers=auth, json={"client_ids": [a["id"]]}).json()
    assert again["count"] == 1
    assert client.delete(f"/api/alerts/clients/{a['id']}/remind", headers=auth).status_code == 200
    assert client.delete(f"/api/alerts/clients/{a['id']}/remind", headers=auth).status_code == 404


def test_bulk_permissions(client: TestClient, auth, usd_id: int, cash_account_id: int) -> None:
    roles = {r["code"]: r["id"] for r in client.get("/api/roles", headers=auth).json()}
    client.post("/api/users", headers=auth, json={"username": "viewer1", "password": "secret123", "role_id": roles["viewer"]})
    token = client.post("/api/auth/login", data={"username": "viewer1", "password": "secret123"}).json()["access_token"]
    viewer = {"Authorization": f"Bearer {token}"}

    person = client.post("/api/clients", headers=auth, json={"name_ar": "مشاهد"}).json()
    assert _bulk(client, viewer, usd_id, cash_account_id, [{"client_id": person["id"], "amount": "1.00"}]).status_code == 403
    assert client.post("/api/alerts/remind/bulk", headers=viewer, json={"client_ids": [person["id"]]}).status_code == 403


def test_a_line_failing_halfway_leaves_nothing_behind(
    client: TestClient, auth, db, usd_id: int, cash_account_id: int, monkeypatch
) -> None:
    """The savepoint, not luck: make allocation fail after the GL entry and
    the receipt of one line are already flushed, and check both are gone."""
    from fastapi import HTTPException

    from app.models import JournalEntry
    from app.services import contracts as contracts_service

    a, contract_a = _sale(client, auth, usd_id, "كريم", "K1")
    real = contracts_service.allocate_payment

    def flaky(db_, contract_id, amount):
        if amount == Decimal("777.00"):
            raise HTTPException(status_code=400, detail="boom")
        return real(db_, contract_id, amount)

    monkeypatch.setattr(contracts_service, "allocate_payment", flaky)
    entries_before = db.scalar(select(func.count()).select_from(JournalEntry))
    body = _bulk(client, auth, usd_id, cash_account_id, [
        {"client_id": a["id"], "amount": "777.00", "contract_id": contract_a["id"]},
        {"client_id": a["id"], "amount": "1000.00", "contract_id": contract_a["id"]},
    ]).json()
    assert [f["detail"] for f in body["failures"]] == ["boom"] and body["count"] == 1
    assert db.scalar(select(func.count()).select_from(JournalEntry)) == entries_before + 1
    assert db.scalar(select(func.count()).select_from(Receipt)) == 1
    assert Decimal(client.get(f"/api/clients/{a['id']}/balance", headers=auth).json()["balance"]) == Decimal("11000.00")
