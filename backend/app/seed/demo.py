"""Demo dataset for a dev database — buildings, units, clients, contracts,
receipts and expenses, enough to make every screen show real numbers.

Created through the public API on purpose: the same validation and GL posting
the UI goes through also guards the seed, so demo data can never be in a state
the app itself could not produce.

    python -m app.seed.demo                        # against localhost:8000
    python -m app.seed.demo --base http://host:8000

Requires the API to be running and already seeded (`python -m app.seed.run`).
Never run this against production.
"""

import argparse
import json
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--base", default="http://127.0.0.1:8000")
parser.add_argument("--username", default="admin")
parser.add_argument("--password", default="admin123")
args = parser.parse_args()

BASE = args.base

def call(method, path, body=None, token=None, form=False):
    data, headers = None, {}
    if form:
        data = urllib.parse.urlencode(body).encode()
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code}: {e.read().decode()}")

tok = call("POST", "/api/auth/login", {"username": args.username, "password": args.password}, form=True)["access_token"]

# Exchange rate so LBP postings are possible at all.
lbp = next(c for c in call("GET", "/api/currencies", token=tok) if c["code"] == "LBP")
usd = next(c for c in call("GET", "/api/currencies", token=tok) if c["is_base"])
call("POST", "/api/exchange-rates",
     {"currency_id": lbp["id"], "rate_date": "2026-01-01", "rate_to_base": "0.0000112"}, token=tok)

cash = next(a for a in call("GET", "/api/accounts?is_cash_bank=true&postable_only=true", token=tok)["items"])

buildings = [
    ("برج المهدي", "بيروت — الطريق الجديدة", 8),
    ("مبنى الزهراء", "بيروت — الشياح", 6),
    ("إقامة النور", "الضاحية — حارة حريك", 5),
]
units_spec = [
    ("A3", 3, "120", "95000"), ("A6", 6, "145", "128000"), ("B7", 2, "110", "84000"),
    ("C2", 4, "98", "76000"),  ("D4", 1, "132", "104000"), ("E5", 5, "128", "99000"),
    ("G1", 0, "64", "52000"),
]
clients_spec = [
    ("علي طلال دهيني", "03 111 222", "1975-3341"),
    ("آمنة دهيني", "70 884 019", "1982-7712"),
    ("حسين صالح قصير", "71 402 337", "1968-9903"),
    ("زينب علي حمود", "76 190 448", "1990-2255"),
    ("نبيل فارس عواضة", "03 776 512", "1979-4408"),
]

bids = [call("POST", "/api/buildings", {"name": n, "address": a, "city": "بيروت", "floors_count": f}, token=tok)["id"]
        for n, a, f in buildings]

uids = []
for i, (no, fl, area, price) in enumerate(units_spec):
    uids.append(call("POST", "/api/apartments", {
        "building_id": bids[i % len(bids)], "unit_no": no, "floor": fl, "area_m2": area,
        "unit_type": "apartment", "status": "available",
        "listed_price": price, "price_currency_id": usd["id"],
    }, token=tok)["id"])

cids = [call("POST", "/api/clients", {"name_ar": n, "phone": p, "national_id": nid}, token=tok)["id"]
        for n, p, nid in clients_spec]

# Three sale contracts and one lease, activated so the ledger has real postings.
sales = [
    ("SALE-2401", 0, 0, "95000.00", "15000.00", 10, "2026-01-10"),
    ("SALE-2402", 1, 1, "128000.00", "20000.00", 12, "2026-02-05"),
    ("SALE-2403", 2, 3, "76000.00", "6000.00", 8, "2026-03-01"),
]
made = []
for no, ci, ui, total, down, n, start in sales:
    c = call("POST", "/api/contracts", {
        "contract_no": no, "contract_type": "sale", "client_id": cids[ci], "apartment_id": uids[ui],
        "currency_id": usd["id"], "sign_date": start, "start_date": start,
        "total_amount": total, "down_payment": down, "installment_count": n, "generate_schedule": True,
    }, token=tok)
    call("POST", f"/api/contracts/{c['id']}/activate", token=tok)
    made.append(c)

lease = call("POST", "/api/contracts", {
    "contract_no": "RENT-2401", "contract_type": "rent", "client_id": cids[3], "apartment_id": uids[2],
    "currency_id": usd["id"], "sign_date": "2026-01-01", "start_date": "2026-01-01",
    "end_date": "2026-12-31", "monthly_rent": "1200.00", "deposit": "2400.00", "generate_schedule": True,
}, token=tok)
call("POST", f"/api/contracts/{lease['id']}/activate", token=tok)

# Invoice the first four rent periods so the tenant has a real receivable.
for row in call("GET", f"/api/contracts/{lease['id']}/schedule", token=tok)[:4]:
    call("POST", f"/api/contracts/{lease['id']}/schedule/{row['id']}/invoice", token=tok)

receipts = [
    (0, made[0]["id"], "2026-02-12", "15000.00", "cash"),
    (0, made[0]["id"], "2026-04-15", "8000.00", "bank_transfer"),
    (1, made[1]["id"], "2026-03-08", "20000.00", "cheque"),
    (2, made[2]["id"], "2026-04-02", "6000.00", "cash"),
    (3, lease["id"],   "2026-03-05", "2400.00", "cash"),
]
for ci, contract_id, day, amount, method in receipts:
    call("POST", "/api/receipts", {
        "receipt_date": day, "client_id": cids[ci], "contract_id": contract_id,
        "cash_account_id": cash["id"], "amount": amount, "currency_id": usd["id"],
        "method": method, "cheque_no": "218447" if method == "cheque" else None, "post": True,
    }, token=tok)

# A couple of operating expenses so the صرف screen is not empty.
expenses = [a for a in call("GET", "/api/accounts?postable_only=true&limit=500", token=tok)["items"]
            if a["account_type"] == "expense"]
for acc, day, amount, note in [
    (expenses[1], "2026-03-20", "1450.00", "صيانة مصاعد برج المهدي"),
    (expenses[0], "2026-04-01", "3200.00", "رواتب الحراسة — آذار"),
]:
    call("POST", "/api/payments", {
        "payment_date": day, "beneficiary_account_id": acc["id"], "cash_account_id": cash["id"],
        "amount": amount, "currency_id": usd["id"], "method": "cash", "notes": note, "post": True,
    }, token=tok)

k = call("GET", "/api/reports/dashboard", token=tok)["kpis"]
tb = call("GET", "/api/accounts/trial-balance", token=tok)
d = sum(float(r["total_debit"]) for r in tb)
c = sum(float(r["total_credit"]) for r in tb)
print(f"buildings={k['total_buildings']} units={k['total_units']} clients={k['total_clients']} contracts={k['active_contracts']}")
print(f"receivable={k['receivable_base']}  collected_this_month={k['collected_this_month']}  overdue={k['overdue_base']}")
print(f"trial balance: debit={d:,.2f} credit={c:,.2f} balanced={abs(d-c) < 0.005}")
