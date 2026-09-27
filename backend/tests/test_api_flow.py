"""End-to-end walk through the business flow the UI is built around:
building → unit → client → sale contract → schedule → receipt → statement.
"""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import Account, Currency, JournalEntry, JournalLine

pytestmark = pytest.mark.usefixtures("db")


@pytest.fixture
def usd_id(db) -> int:
    return db.scalars(select(Currency.id).where(Currency.code == "USD")).one()


@pytest.fixture
def cash_account_id(db) -> int:
    return db.scalars(select(Account.id).where(Account.code == "1110")).one()


def test_health_needs_no_auth(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}


def test_protected_route_rejects_anonymous(client: TestClient) -> None:
    assert client.get("/api/clients").status_code == 401


def test_login_rejects_bad_password(client: TestClient) -> None:
    response = client.post("/api/auth/login", data={"username": "tester", "password": "wrong"})
    assert response.status_code == 401


def test_chart_of_accounts_is_seeded_as_a_tree(client: TestClient, auth) -> None:
    tree = client.get("/api/accounts/tree", headers=auth).json()
    roots = {node["code"] for node in tree}
    assert {"1", "2", "3", "4", "5", "6"} <= roots

    assets = next(node for node in tree if node["code"] == "1")
    assert any(child["code"] == "11" for child in assets["children"])

    # Every account exactly once. Validating ORM rows straight into the tree
    # schema used to pull the `children` backref in as well, and the builder
    # then appended each node again — one extra copy per level of depth.
    ids: list[int] = []

    def walk(nodes: list[dict]) -> None:
        for node in nodes:
            ids.append(node["id"])
            walk(node["children"])

    walk(tree)
    assert len(ids) == len(set(ids))
    assert len(ids) == db_account_count(client, auth)


def db_account_count(client: TestClient, auth) -> int:
    return client.get("/api/accounts", params={"limit": 1}, headers=auth).json()["total"]


def test_client_gets_its_own_receivable_account(client: TestClient, auth) -> None:
    response = client.post(
        "/api/clients", headers=auth, json={"name_ar": "سامي حداد", "phone": "03 111 222"}
    )
    assert response.status_code == 201, response.text

    created = response.json()
    assert created["account_id"] is not None

    account = client.get(f"/api/accounts/{created['account_id']}", headers=auth).json()
    assert account["code"].startswith("4110")
    assert account["is_client"] is True


def test_client_account_numbering_follows_the_parent(client: TestClient, auth, db) -> None:
    """A legacy-shaped parent keeps its own suffix width.

    The imported chart numbers customers 411 + five digits, so a new client
    under it must get 41100219, not the default-width 4110219 alongside it.
    """
    from app.models import Account, AccountType
    from app.services.accounts import next_child_code

    parent = Account(code="411", name_ar="فواتير الزبائن", account_type=AccountType.asset, is_postable=False)
    db.add(parent)
    db.flush()
    db.add(
        Account(
            code="41100218",
            name_ar="زبون قديم",
            parent_id=parent.id,
            account_type=AccountType.asset,
            is_client=True,
        )
    )
    db.flush()

    assert next_child_code(db, parent) == "41100219"


def test_sale_contract_builds_a_schedule_that_sums_to_the_financed_amount(
    client: TestClient, auth, usd_id: int
) -> None:
    building = client.post("/api/buildings", headers=auth, json={"name": "برج المهدي"}).json()
    unit = client.post(
        "/api/apartments",
        headers=auth,
        json={"building_id": building["id"], "unit_no": "A3", "floor": 3, "area_m2": "120"},
    ).json()
    buyer = client.post("/api/clients", headers=auth, json={"name_ar": "سامي حداد"}).json()

    response = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": "SALE-001",
            "contract_type": "sale",
            "client_id": buyer["id"],
            "apartment_id": unit["id"],
            "currency_id": usd_id,
            "sign_date": "2026-01-10",
            "start_date": "2026-01-10",
            "total_amount": "100000.00",
            "down_payment": "10000.00",
            "installment_count": 7,   # 90000/7 does not divide evenly
        },
    )
    assert response.status_code == 201, response.text
    contract = response.json()

    schedule = client.get(f"/api/contracts/{contract['id']}/schedule", headers=auth).json()
    assert len(schedule) == 7
    assert sum(Decimal(row["amount"]) for row in schedule) == Decimal("90000.00")
    assert schedule[0]["due_date"] == "2026-02-10"
    assert schedule[-1]["due_date"] == "2026-08-10"


def test_rent_contract_bills_one_period_per_month(client: TestClient, auth, usd_id: int) -> None:
    building = client.post("/api/buildings", headers=auth, json={"name": "برج ب"}).json()
    unit = client.post(
        "/api/apartments", headers=auth, json={"building_id": building["id"], "unit_no": "B7"}
    ).json()
    tenant = client.post("/api/clients", headers=auth, json={"name_ar": "ليلى"}).json()

    contract = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": "RENT-001",
            "contract_type": "rent",
            "client_id": tenant["id"],
            "apartment_id": unit["id"],
            "currency_id": usd_id,
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "monthly_rent": "500.00",
        },
    ).json()

    schedule = client.get(f"/api/contracts/{contract['id']}/schedule", headers=auth).json()
    assert len(schedule) == 12
    assert all(Decimal(row["amount"]) == Decimal("500.00") for row in schedule)


def test_contract_rejects_an_already_sold_unit(client: TestClient, auth, usd_id: int) -> None:
    building = client.post("/api/buildings", headers=auth, json={"name": "برج ج"}).json()
    unit = client.post(
        "/api/apartments",
        headers=auth,
        json={"building_id": building["id"], "unit_no": "C1", "status": "sold"},
    ).json()
    buyer = client.post("/api/clients", headers=auth, json={"name_ar": "خالد"}).json()

    response = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": "SALE-DUP",
            "contract_type": "sale",
            "client_id": buyer["id"],
            "apartment_id": unit["id"],
            "currency_id": usd_id,
            "start_date": "2026-01-01",
            "total_amount": "50000",
            "installment_count": 5,
        },
    )
    assert response.status_code == 409


def test_activation_posts_the_sale_and_flags_the_unit(
    client: TestClient, auth, db, usd_id: int
) -> None:
    building = client.post("/api/buildings", headers=auth, json={"name": "برج د"}).json()
    unit = client.post(
        "/api/apartments", headers=auth, json={"building_id": building["id"], "unit_no": "D4"}
    ).json()
    buyer = client.post("/api/clients", headers=auth, json={"name_ar": "نبيل"}).json()
    contract = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": "SALE-002",
            "contract_type": "sale",
            "client_id": buyer["id"],
            "apartment_id": unit["id"],
            "currency_id": usd_id,
            "sign_date": "2026-02-01",
            "start_date": "2026-02-01",
            "total_amount": "80000.00",
            "installment_count": 8,
        },
    ).json()

    activated = client.post(f"/api/contracts/{contract['id']}/activate", headers=auth)
    assert activated.status_code == 200, activated.text
    assert activated.json()["status"] == "active"

    assert client.get(f"/api/apartments/{unit['id']}", headers=auth).json()["status"] == "sold"

    entry = db.scalars(
        select(JournalEntry).where(JournalEntry.contract_id == contract["id"])
    ).one()
    assert entry.entry_type.value == "sale"
    assert entry.is_posted

    lines = db.scalars(select(JournalLine).where(JournalLine.entry_id == entry.id)).all()
    assert sum(Decimal(line.debit_base) for line in lines) == Decimal("80000.00")
    assert sum(Decimal(line.credit_base) for line in lines) == Decimal("80000.00")


def test_receipt_posts_to_the_gl_and_pays_down_the_schedule(
    client: TestClient, auth, usd_id: int, cash_account_id: int
) -> None:
    building = client.post("/api/buildings", headers=auth, json={"name": "برج هـ"}).json()
    unit = client.post(
        "/api/apartments", headers=auth, json={"building_id": building["id"], "unit_no": "E5"}
    ).json()
    buyer = client.post("/api/clients", headers=auth, json={"name_ar": "رامي"}).json()
    contract = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": "SALE-003",
            "contract_type": "sale",
            "client_id": buyer["id"],
            "apartment_id": unit["id"],
            "currency_id": usd_id,
            "sign_date": "2026-03-01",
            "start_date": "2026-03-01",
            "total_amount": "12000.00",
            "installment_count": 12,   # 1000 a month
        },
    ).json()
    client.post(f"/api/contracts/{contract['id']}/activate", headers=auth)

    # 2500 covers two full installments and half of the third.
    receipt = client.post(
        "/api/receipts",
        headers=auth,
        json={
            "receipt_date": "2026-04-05",
            "client_id": buyer["id"],
            "contract_id": contract["id"],
            "cash_account_id": cash_account_id,
            "amount": "2500.00",
            "currency_id": usd_id,
        },
    )
    assert receipt.status_code == 201, receipt.text
    assert receipt.json()["receipt_no"] == "REC-0001"
    assert receipt.json()["journal_entry_id"] is not None

    schedule = client.get(f"/api/contracts/{contract['id']}/schedule", headers=auth).json()
    assert [row["status"] for row in schedule[:4]] == ["paid", "paid", "partial", "pending"]
    assert Decimal(schedule[2]["paid_amount"]) == Decimal("500.00")

    # Client owes 12000 (the sale) less 2500 collected.
    balance = client.get(f"/api/clients/{buyer['id']}/balance", headers=auth).json()
    assert Decimal(balance["balance"]) == Decimal("9500.00")
    assert balance["last_payment_date"] == "2026-04-05"


def test_voiding_a_receipt_reverses_allocation_and_ledger(
    client: TestClient, auth, usd_id: int, cash_account_id: int
) -> None:
    building = client.post("/api/buildings", headers=auth, json={"name": "برج و"}).json()
    unit = client.post(
        "/api/apartments", headers=auth, json={"building_id": building["id"], "unit_no": "F1"}
    ).json()
    buyer = client.post("/api/clients", headers=auth, json={"name_ar": "مازن"}).json()
    contract = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": "SALE-004",
            "contract_type": "sale",
            "client_id": buyer["id"],
            "apartment_id": unit["id"],
            "currency_id": usd_id,
            "sign_date": "2026-03-01",
            "start_date": "2026-03-01",
            "total_amount": "6000.00",
            "installment_count": 6,
        },
    ).json()
    client.post(f"/api/contracts/{contract['id']}/activate", headers=auth)

    receipt = client.post(
        "/api/receipts",
        headers=auth,
        json={
            "receipt_date": "2026-04-05",
            "client_id": buyer["id"],
            "contract_id": contract["id"],
            "cash_account_id": cash_account_id,
            "amount": "1000.00",
            "currency_id": usd_id,
        },
    ).json()

    assert client.delete(f"/api/receipts/{receipt['id']}", headers=auth).status_code == 200

    schedule = client.get(f"/api/contracts/{contract['id']}/schedule", headers=auth).json()
    assert all(Decimal(row["paid_amount"]) == 0 for row in schedule)
    assert all(row["status"] == "pending" for row in schedule)

    # The receivable is back to the full sale price.
    balance = client.get(f"/api/clients/{buyer['id']}/balance", headers=auth).json()
    assert Decimal(balance["balance"]) == Decimal("6000.00")


def test_statement_running_balance_tracks_the_documents(
    client: TestClient, auth, usd_id: int, cash_account_id: int
) -> None:
    building = client.post("/api/buildings", headers=auth, json={"name": "برج ز"}).json()
    unit = client.post(
        "/api/apartments", headers=auth, json={"building_id": building["id"], "unit_no": "G1"}
    ).json()
    buyer = client.post("/api/clients", headers=auth, json={"name_ar": "هدى"}).json()
    contract = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": "SALE-005",
            "contract_type": "sale",
            "client_id": buyer["id"],
            "apartment_id": unit["id"],
            "currency_id": usd_id,
            "sign_date": "2026-01-05",
            "start_date": "2026-01-05",
            "total_amount": "80000.00",
            "installment_count": 10,
        },
    ).json()
    client.post(f"/api/contracts/{contract['id']}/activate", headers=auth)
    client.post(
        "/api/receipts",
        headers=auth,
        json={
            "receipt_date": "2026-02-12",
            "client_id": buyer["id"],
            "contract_id": contract["id"],
            "cash_account_id": cash_account_id,
            "amount": "10000.00",
            "currency_id": usd_id,
        },
    )

    statement = client.get(f"/api/clients/{buyer['id']}/statement", headers=auth).json()
    assert [Decimal(line["running_balance_base"]) for line in statement["lines"]] == [
        Decimal("80000.00"),
        Decimal("70000.00"),
    ]
    assert Decimal(statement["closing_balance"]) == Decimal("70000.00")

    # Filtering by period folds everything earlier into the opening balance.
    filtered = client.get(
        f"/api/clients/{buyer['id']}/statement",
        headers=auth,
        params={"date_from": "2026-02-01"},
    ).json()
    assert Decimal(filtered["opening_balance"]) == Decimal("80000.00")
    assert len(filtered["lines"]) == 1
    assert Decimal(filtered["closing_balance"]) == Decimal("70000.00")


def test_sales_and_monthly_reports_follow_the_ledger(
    client: TestClient, auth, usd_id: int, cash_account_id: int
) -> None:
    """The sale shows once at the price charged, and the month adds up."""
    building = client.post("/api/buildings", headers=auth, json={"name": "برج ر"}).json()
    unit = client.post(
        "/api/apartments", headers=auth, json={"building_id": building["id"], "unit_no": "R1"}
    ).json()
    buyer = client.post("/api/clients", headers=auth, json={"name_ar": "هدى"}).json()
    contract = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": "SALE-007",
            "contract_type": "sale",
            "client_id": buyer["id"],
            "apartment_id": unit["id"],
            "currency_id": usd_id,
            "sign_date": "2026-05-04",
            "start_date": "2026-05-04",
            "total_amount": "50000.00",
            "installment_count": 5,
        },
    ).json()
    client.post(f"/api/contracts/{contract['id']}/activate", headers=auth)
    client.post(
        "/api/receipts",
        headers=auth,
        json={
            "receipt_date": "2026-05-20",
            "client_id": buyer["id"],
            "contract_id": contract["id"],
            "cash_account_id": cash_account_id,
            "amount": "12000.00",
            "currency_id": usd_id,
        },
    )

    sales = client.get("/api/reports/sales", headers=auth).json()
    mine = [row for row in sales["rows"] if row["client_id"] == buyer["id"]]
    assert len(mine) == 1, "one row per sale document, not per revenue line"
    assert Decimal(mine[0]["amount_base"]) == Decimal("50000.00")
    assert mine[0]["client_name"] == "هدى"

    monthly = client.get("/api/reports/monthly", headers=auth).json()
    may = next(row for row in monthly["rows"] if row["month"] == "2026-05")
    assert Decimal(may["sales_base"]) == Decimal("50000.00")
    assert Decimal(may["received_base"]) == Decimal("12000.00")
    assert Decimal(may["net_base"]) == Decimal(may["received_base"]) - Decimal(may["paid_base"])

    # and the period filter actually narrows both
    empty = client.get("/api/reports/sales", headers=auth, params={"date_from": "2027-01-01"}).json()
    assert empty["rows"] == []
    assert Decimal(empty["total_base"]) == Decimal(0)


def test_trial_balance_is_balanced(client: TestClient, auth, usd_id: int, cash_account_id: int) -> None:
    building = client.post("/api/buildings", headers=auth, json={"name": "برج ح"}).json()
    unit = client.post(
        "/api/apartments", headers=auth, json={"building_id": building["id"], "unit_no": "H1"}
    ).json()
    buyer = client.post("/api/clients", headers=auth, json={"name_ar": "زياد"}).json()
    contract = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": "SALE-006",
            "contract_type": "sale",
            "client_id": buyer["id"],
            "apartment_id": unit["id"],
            "currency_id": usd_id,
            "sign_date": "2026-01-05",
            "start_date": "2026-01-05",
            "total_amount": "40000.00",
            "installment_count": 4,
        },
    ).json()
    client.post(f"/api/contracts/{contract['id']}/activate", headers=auth)
    client.post(
        "/api/receipts",
        headers=auth,
        json={
            "receipt_date": "2026-02-01",
            "client_id": buyer["id"],
            "contract_id": contract["id"],
            "cash_account_id": cash_account_id,
            "amount": "7500.00",
            "currency_id": usd_id,
        },
    )

    rows = client.get("/api/accounts/trial-balance", headers=auth).json()
    assert sum(Decimal(r["total_debit"]) for r in rows) == sum(Decimal(r["total_credit"]) for r in rows)


def test_trial_balance_drops_voided_entries_and_honours_the_period(
    client: TestClient, auth, usd_id: int, cash_account_id: int
) -> None:
    """A voided receipt must leave the trial balance, and a period must narrow it.

    Both used to fail the same way: the entry filter sat on an outer join, so
    it nulled the entry columns without dropping the line, and the amounts kept
    counting. Debit and credit fell out together, so the sheet still balanced —
    it was just wrong.
    """
    buyer = client.post("/api/clients", headers=auth, json={"name_ar": "سلمى"}).json()
    account_id = buyer["account_id"]

    def totals(**params) -> Decimal:
        rows = client.get("/api/accounts/trial-balance", headers=auth, params=params).json()
        row = next((r for r in rows if r["account_id"] == account_id), None)
        return Decimal(row["total_debit"]) if row else Decimal(0)

    entry = client.post(
        "/api/journal",
        headers=auth,
        json={
            "entry_date": "2026-03-10",
            "entry_type": "adjustment",
            "currency_id": usd_id,
            "post": True,
            "lines": [
                {"account_id": account_id, "debit": "1000.00"},
                {"account_id": cash_account_id, "credit": "1000.00"},
            ],
        },
    ).json()
    assert totals() == Decimal("1000.00")

    # a period that excludes the entry excludes its amounts
    assert totals(date_from="2026-04-01") == Decimal(0)
    assert totals(date_to="2026-03-31") == Decimal("1000.00")

    client.delete(f"/api/journal/{entry['id']}", headers=auth)
    assert totals() == Decimal(0)


def test_manual_entry_must_balance(client: TestClient, auth, usd_id: int, cash_account_id: int) -> None:
    response = client.post(
        "/api/journal",
        headers=auth,
        json={
            "entry_date": "2026-01-01",
            "entry_type": "adjustment",
            "currency_id": usd_id,
            "lines": [
                {"account_id": cash_account_id, "debit": "100.00"},
                {"account_id": cash_account_id, "credit": "90.00"},
            ],
        },
    )
    assert response.status_code == 422
    assert "not balanced" in response.text


def test_manual_entry_rejects_header_accounts(client: TestClient, auth, db, usd_id: int) -> None:
    header_id = db.scalars(select(Account.id).where(Account.code == "1")).one()
    postable_id = db.scalars(select(Account.id).where(Account.code == "1110")).one()

    response = client.post(
        "/api/journal",
        headers=auth,
        json={
            "entry_date": "2026-01-01",
            "entry_type": "adjustment",
            "currency_id": usd_id,
            "lines": [
                {"account_id": header_id, "debit": "100.00"},
                {"account_id": postable_id, "credit": "100.00"},
            ],
        },
    )
    assert response.status_code == 400
    assert "header" in response.text


def test_posting_in_a_foreign_currency_needs_a_rate(client: TestClient, auth, db, cash_account_id: int) -> None:
    lbp_id = db.scalars(select(Currency.id).where(Currency.code == "LBP")).one()
    payload = {
        "entry_date": "2026-01-01",
        "entry_type": "adjustment",
        "currency_id": lbp_id,
        "lines": [
            {"account_id": cash_account_id, "debit": "1000000.00"},
            {"account_id": cash_account_id, "credit": "1000000.00"},
        ],
    }

    missing = client.post("/api/journal", headers=auth, json=payload)
    assert missing.status_code == 400
    assert "exchange rate" in missing.text

    client.post(
        "/api/exchange-rates",
        headers=auth,
        json={"currency_id": lbp_id, "rate_date": "2026-01-01", "rate_to_base": "0.0000111"},
    )
    assert client.post("/api/journal", headers=auth, json=payload).status_code == 201


def test_dashboard_reports_the_headline_numbers(
    client: TestClient, auth, usd_id: int, cash_account_id: int
) -> None:
    building = client.post("/api/buildings", headers=auth, json={"name": "برج ط"}).json()
    unit = client.post(
        "/api/apartments", headers=auth, json={"building_id": building["id"], "unit_no": "K1"}
    ).json()
    buyer = client.post("/api/clients", headers=auth, json={"name_ar": "فادي"}).json()
    contract = client.post(
        "/api/contracts",
        headers=auth,
        json={
            "contract_no": "SALE-007",
            "contract_type": "sale",
            "client_id": buyer["id"],
            "apartment_id": unit["id"],
            "currency_id": usd_id,
            "sign_date": "2026-01-05",
            "start_date": "2026-01-05",
            "total_amount": "20000.00",
            "installment_count": 4,
        },
    ).json()
    client.post(f"/api/contracts/{contract['id']}/activate", headers=auth)

    dashboard = client.get("/api/reports/dashboard", headers=auth, params={"as_of": "2026-06-01"}).json()
    kpis = dashboard["kpis"]
    assert kpis["total_buildings"] == 1
    assert kpis["total_units"] == 1
    assert kpis["units_sold"] == 1
    assert kpis["active_contracts"] == 1
    assert Decimal(kpis["receivable_base"]) == Decimal("20000.00")
    assert len(dashboard["recent_docs"]) == 1

    overdue = client.get("/api/contracts/overdue", headers=auth, params={"as_of": "2026-06-01"}).json()
    assert len(overdue) == 4  # all four installments were due before June
    assert overdue[0]["days_late"] > 0


def test_building_delete_is_blocked_while_units_remain(client: TestClient, auth) -> None:
    building = client.post("/api/buildings", headers=auth, json={"name": "برج ي"}).json()
    client.post("/api/apartments", headers=auth, json={"building_id": building["id"], "unit_no": "L1"})

    blocked = client.delete(f"/api/buildings/{building['id']}", headers=auth)
    assert blocked.status_code == 409


def _role_id(client: TestClient, auth, code: str) -> int:
    return next(r["id"] for r in client.get("/api/roles", headers=auth).json() if r["code"] == code)


def test_viewer_role_cannot_write(client: TestClient, auth) -> None:
    client.post(
        "/api/users",
        headers=auth,
        json={"username": "watcher", "password": "secret123", "role_id": _role_id(client, auth, "viewer")},
    )
    token = client.post(
        "/api/auth/login", data={"username": "watcher", "password": "secret123"}
    ).json()["access_token"]
    viewer = {"Authorization": f"Bearer {token}"}

    assert client.get("/api/clients", headers=viewer).status_code == 200
    assert client.post("/api/clients", headers=viewer, json={"name_ar": "x"}).status_code == 403


def test_change_own_password(client: TestClient, auth) -> None:
    """A user must be able to change their own password without an admin.

    Everything else about a user is admin-only; this cannot be, or the shipped
    `admin` account has no way to stop being `admin123`.
    """
    wrong = client.post(
        "/api/auth/change-password",
        headers=auth,
        json={"current_password": "not-it", "new_password": "brand-new-1"},
    )
    assert wrong.status_code == 400

    same = client.post(
        "/api/auth/change-password",
        headers=auth,
        json={"current_password": "secret123", "new_password": "secret123"},
    )
    assert same.status_code == 400

    changed = client.post(
        "/api/auth/change-password",
        headers=auth,
        json={"current_password": "secret123", "new_password": "brand-new-1"},
    )
    assert changed.status_code == 200, changed.text

    assert client.post(
        "/api/auth/login", data={"username": "tester", "password": "secret123"}
    ).status_code == 401
    assert client.post(
        "/api/auth/login", data={"username": "tester", "password": "brand-new-1"}
    ).status_code == 200


def test_org_settings_round_trip(client: TestClient, auth) -> None:
    """The letterhead reads back defaulted, saves, and stays a single row."""
    first = client.get("/api/org-settings", headers=auth).json()
    assert first["name"]

    saved = client.put(
        "/api/org-settings",
        headers=auth,
        json={"name": "المهدي للإنماء والإعمار", "phone": "01 555 222", "tax_no": "12345"},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["name"] == "المهدي للإنماء والإعمار"

    again = client.get("/api/org-settings", headers=auth).json()
    assert again["name"] == "المهدي للإنماء والإعمار"
    assert again["phone"] == "01 555 222"
    # the untouched default survives a partial update
    assert again["subtitle"] == first["subtitle"]
