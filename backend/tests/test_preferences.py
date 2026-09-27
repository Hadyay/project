"""Per-user interface preferences: theme, language, simple mode."""

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import User


def test_preferences_default_and_partial_update(client: TestClient, auth) -> None:
    me = client.get("/api/auth/me", headers=auth).json()
    assert me["preferences"] == {"theme": "light", "lang": "ar", "simple_mode": False}

    r = client.put("/api/auth/preferences", headers=auth, json={"theme": "dark"})
    assert r.status_code == 200, r.text
    assert r.json() == {"theme": "dark", "lang": "ar", "simple_mode": False}

    # Partial: only what is sent changes; the earlier choice stays.
    r = client.put("/api/auth/preferences", headers=auth, json={"simple_mode": True, "lang": "en"})
    assert r.json() == {"theme": "dark", "lang": "en", "simple_mode": True}
    assert client.get("/api/auth/me", headers=auth).json()["preferences"] == r.json()

    assert client.put("/api/auth/preferences", headers=auth, json={"theme": "pink"}).status_code == 422
    assert client.put("/api/auth/preferences", headers=auth, json={"lang": "fr"}).status_code == 422


def test_preferences_are_per_user_and_ungated(client: TestClient, auth) -> None:
    empty = client.post("/api/roles", headers=auth, json={"code": "nothing", "name": "لا شيء", "permissions": []}).json()
    client.post("/api/users", headers=auth, json={"username": "plain", "password": "secret123", "role_id": empty["id"]})
    token = client.post("/api/auth/login", data={"username": "plain", "password": "secret123"}).json()["access_token"]
    plain = {"Authorization": f"Bearer {token}"}

    # A user with no permissions at all may still choose how screens look to them.
    r = client.put("/api/auth/preferences", headers=plain, json={"theme": "dark", "simple_mode": True})
    assert r.status_code == 200, r.text
    # ...and it does not touch anyone else's.
    assert client.get("/api/auth/me", headers=auth).json()["preferences"]["theme"] == "light"
    assert client.put("/api/auth/preferences", json={"theme": "dark"}).status_code == 401


def test_a_bad_stored_value_costs_only_itself(client: TestClient, auth, db) -> None:
    tester = db.scalars(select(User).where(User.username == "tester")).one()
    tester.preferences = {"theme": "neon", "lang": "en", "legacy_key": 1}
    db.commit()
    me = client.get("/api/auth/me", headers=auth)
    assert me.status_code == 200
    assert me.json()["preferences"] == {"theme": "light", "lang": "en", "simple_mode": False}
