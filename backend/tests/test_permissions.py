"""Dynamic access rights: roles are data, every endpoint checks them, and a
change applies on the next request — no new sign-in."""

from fastapi.testclient import TestClient

from app.core.permissions import ALL_PERMISSIONS


def _roles(client: TestClient, auth) -> dict[str, dict]:
    return {r["code"]: r for r in client.get("/api/roles", headers=auth).json()}


def _login(client: TestClient, username: str, password: str = "secret123") -> dict[str, str]:
    token = client.post("/api/auth/login", data={"username": username, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _user(client: TestClient, auth, username: str, role_id: int) -> dict:
    created = client.post(
        "/api/users", headers=auth, json={"username": username, "password": "secret123", "role_id": role_id}
    )
    assert created.status_code == 201, created.text
    return created.json()


def test_default_roles_and_catalog(client: TestClient, auth) -> None:
    roles = _roles(client, auth)
    assert set(roles) == {"admin", "accountant", "sales", "viewer"}
    assert roles["admin"]["is_system"] and set(roles["admin"]["permissions"]) == ALL_PERMISSIONS
    assert "journal.create" in roles["accountant"]["permissions"]
    assert "journal.create" not in roles["sales"]["permissions"]
    assert all(p.endswith(".view") for p in roles["viewer"]["permissions"])

    catalog = client.get("/api/roles/permissions", headers=auth).json()
    codes = {a["code"] for module in catalog for a in module["actions"]}
    assert codes == ALL_PERMISSIONS

    me = client.get("/api/auth/me", headers=auth).json()
    assert me["role"]["code"] == "admin" and set(me["permissions"]) == ALL_PERMISSIONS


def test_custom_role_grants_exactly_what_it_lists(client: TestClient, auth) -> None:
    role = client.post(
        "/api/roles",
        headers=auth,
        json={"code": "front_desk", "name": "استقبال", "permissions": ["clients.view", "clients.create"]},
    )
    assert role.status_code == 201, role.text
    _user(client, auth, "desk", role.json()["id"])
    desk = _login(client, "desk")

    assert client.get("/api/clients", headers=desk).status_code == 200
    created = client.post("/api/clients", headers=desk, json={"name_ar": "عميل الاستقبال"})
    assert created.status_code == 201
    # Everything not granted is refused — reads included.
    assert client.delete(f"/api/clients/{created.json()['id']}", headers=desk).status_code == 403
    assert client.get("/api/journal", headers=desk).status_code == 403
    assert client.get("/api/accounts/trial-balance", headers=desk).status_code == 403
    assert client.get("/api/receipts", headers=desk).status_code == 403
    assert client.get("/api/users", headers=desk).status_code == 403

    me = client.get("/api/auth/me", headers=desk).json()
    assert me["permissions"] == ["clients.create", "clients.view"]


def test_role_change_applies_on_the_next_request(client: TestClient, auth) -> None:
    role = client.post(
        "/api/roles", headers=auth, json={"code": "clerk", "name": "كاتب", "permissions": ["clients.view"]}
    ).json()
    _user(client, auth, "clerk1", role["id"])
    clerk = _login(client, "clerk1")
    assert client.get("/api/journal", headers=clerk).status_code == 403

    client.patch(f"/api/roles/{role['id']}", headers=auth, json={"permissions": ["clients.view", "journal.view"]})
    assert client.get("/api/journal", headers=clerk).status_code == 200  # same token

    client.patch(f"/api/roles/{role['id']}", headers=auth, json={"permissions": []})
    assert client.get("/api/clients", headers=clerk).status_code == 403

    # Moving the user to another role takes effect just as fast.
    viewer = _roles(client, auth)["viewer"]
    client.patch(f"/api/users/{_uid(client, auth, 'clerk1')}", headers=auth, json={"role_id": viewer["id"]})
    assert client.get("/api/clients", headers=clerk).status_code == 200


def _uid(client: TestClient, auth, username: str) -> int:
    return next(u["id"] for u in client.get("/api/users", headers=auth).json() if u["username"] == username)


def test_pickers_follow_the_screens_that_use_them(client: TestClient, auth) -> None:
    """A cashier who may record receipts must be able to pick the client —
    without being able to open the client register's statements."""
    role = client.post(
        "/api/roles",
        headers=auth,
        json={"code": "cashier", "name": "صندوق", "permissions": ["receipts.view", "receipts.create"]},
    ).json()
    _user(client, auth, "cash1", role["id"])
    cashier = _login(client, "cash1")
    someone = client.post("/api/clients", headers=auth, json={"name_ar": "عميل"}).json()

    assert client.get("/api/clients", headers=cashier).status_code == 200
    assert client.get("/api/accounts", params={"is_cash_bank": True}, headers=cashier).status_code == 200
    assert client.get(f"/api/clients/{someone['id']}/statement", headers=cashier).status_code == 403
    assert client.post("/api/clients", headers=cashier, json={"name_ar": "x"}).status_code == 403


def test_role_rules_that_prevent_lockout(client: TestClient, auth) -> None:
    roles = _roles(client, auth)
    admin_role = roles["admin"]

    # The system role is fixed.
    assert client.patch(f"/api/roles/{admin_role['id']}", headers=auth, json={"permissions": []}).status_code == 400
    assert client.delete(f"/api/roles/{admin_role['id']}", headers=auth).status_code == 400

    # Unknown permission codes are refused, not silently stored.
    bad = client.post("/api/roles", headers=auth, json={"code": "bad", "name": "سيء", "permissions": ["clients.fly"]})
    assert bad.status_code == 400

    # A role in use cannot be deleted; an unused one can.
    temp = client.post("/api/roles", headers=auth, json={"code": "temp", "name": "مؤقت", "permissions": []}).json()
    user = _user(client, auth, "tempuser", temp["id"])
    assert client.delete(f"/api/roles/{temp['id']}", headers=auth).status_code == 400
    client.patch(f"/api/users/{user['id']}", headers=auth, json={"role_id": roles["viewer"]["id"]})
    assert client.delete(f"/api/roles/{temp['id']}", headers=auth).status_code == 200

    # The last active full administrator can be neither demoted nor deactivated.
    me = client.get("/api/auth/me", headers=auth).json()
    demote = client.patch(f"/api/users/{me['id']}", headers=auth, json={"role_id": roles["viewer"]["id"]})
    assert demote.status_code == 400
    second = _user(client, auth, "admin2", admin_role["id"])
    assert client.patch(f"/api/users/{me['id']}", headers=auth, json={"role_id": roles["viewer"]["id"]}).status_code == 200
    # ...and now admin2 is the last one: it cannot demote itself either.
    last = client.patch(
        f"/api/users/{second['id']}", headers=_login(client, "admin2"), json={"role_id": roles["viewer"]["id"]}
    )
    assert last.status_code == 400 and "آخر مستخدم" in last.json()["detail"]
