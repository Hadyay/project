"""Database backups: make, list, download, prune, the daily run, and who may."""

import os
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import settings
from app.models import AuditLog
from app.services import backup as backup_service

from tests.conftest import TEST_DATABASE_URL


@pytest.fixture
def backup_dir(tmp_path: Path, monkeypatch) -> Path:
    """Backups of the *test* database, into a temporary folder."""
    monkeypatch.setattr(settings, "backup_dir", str(tmp_path))
    monkeypatch.setattr(settings, "database_url", TEST_DATABASE_URL)
    monkeypatch.setattr(backup_service, "last_auto_failure", None)
    return tmp_path


def _needs_pg_dump() -> None:
    try:
        backup_service._dump_command()
    except backup_service.BackupError as exc:
        pytest.skip(f"no usable pg_dump here: {exc}")


def _touch(folder: Path, when: datetime, kind: str = "auto", body: bytes = b"x") -> Path:
    path = folder / f"erp_backup_{when:%Y-%m-%d_%H%M%S}_{kind}.sql"
    path.write_bytes(body)
    return path


def test_backup_now_list_download_and_audit(client: TestClient, auth, db, backup_dir: Path) -> None:
    _needs_pg_dump()
    made = client.post("/api/backups", headers=auth)
    assert made.status_code == 201, made.text
    item = made.json()
    assert backup_service.NAME.match(item["name"]) and item["kind"] == "manual" and item["size_bytes"] > 10_000

    path = backup_dir / item["name"]
    text = path.read_bytes()
    assert b"-- PostgreSQL database dump complete" in text[-4096:]
    assert b'CREATE TABLE "public"."journal_lines"' in text and b"tester" in text  # schema and rows
    assert not list(backup_dir.glob("*.part"))

    status = client.get("/api/backups", headers=auth).json()
    assert [b["name"] for b in status["items"]] == [item["name"]]
    assert status["total_bytes"] == item["size_bytes"] and status["latest_at"] is not None
    assert status["folder"] == str(backup_dir) and status["last_auto_failure"] is None

    download = client.get(f"/api/backups/{item['name']}", headers=auth)
    assert download.status_code == 200 and download.content == text
    assert item["name"] in download.headers["content-disposition"]

    logged = db.scalars(select(AuditLog.action).where(AuditLog.table_name == "backups").order_by(AuditLog.id)).all()
    assert logged == ["insert", "export"]


def test_download_only_reaches_backups(client: TestClient, auth, backup_dir: Path) -> None:
    (backup_dir / "realestate_erp_full.sql").write_text("not a dated backup")
    (backup_dir.parent / "secret.sql").write_text("outside")
    for name in ("realestate_erp_full.sql", "..%2Fsecret.sql", "erp_backup_2026-01-01_000000_auto.sql"):
        assert client.get(f"/api/backups/{name}", headers=auth).status_code == 404, name


def test_prune_keeps_a_month_and_never_fewer_than_seven(backup_dir: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "backup_keep_days", 30)
    monkeypatch.setattr(settings, "backup_keep_min", 7)
    now = datetime(2026, 9, 28, 12, 0, 0)
    recent = [_touch(backup_dir, now - timedelta(days=d)) for d in (1, 2, 3)]
    old = [_touch(backup_dir, now - timedelta(days=d)) for d in range(40, 47)]  # 40…46 days
    other = backup_dir / "realestate_erp_full.sql"
    other.write_text("the moving file — never ours to delete")
    stale = backup_dir / "erp_backup_2026-09-01_000000_auto.sql.part"
    stale.write_bytes(b"half")
    os.utime(stale, ((now - timedelta(days=2)).timestamp(),) * 2)

    removed = backup_service.prune(now)
    # Newest 7 stay (3 recent + the 4 newest old ones); the 3 oldest go.
    assert sorted(removed) == sorted(p.name for p in old[4:])
    assert all(p.exists() for p in recent + old[:4]) and other.exists() and not stale.exists()


def test_the_daily_run(client: TestClient, auth, backup_dir: Path, monkeypatch) -> None:
    calls: list[str] = []

    def fake_create(kind: str = "manual") -> backup_service.BackupFile:
        calls.append(kind)
        _touch(backup_dir, datetime.now(), kind)
        return backup_service.list_backups()[0]

    monkeypatch.setattr(backup_service, "create", fake_create)
    assert backup_service.run_if_due() is not None and calls == ["auto"]  # none yet: due
    assert backup_service.run_if_due() is None and calls == ["auto"]      # made just now: not due

    # A failing automatic run is remembered and shown until one succeeds.
    for f in backup_dir.iterdir():
        f.unlink()

    def broken(kind: str = "manual") -> backup_service.BackupFile:
        raise backup_service.BackupError("فشل pg_dump: disk full")

    monkeypatch.setattr(backup_service, "create", broken)
    assert backup_service.run_if_due() is None
    shown = client.get("/api/backups", headers=auth).json()["last_auto_failure"]
    assert shown["message"] == "فشل pg_dump: disk full"
    monkeypatch.setattr(backup_service, "create", fake_create)
    backup_service.run_if_due()
    assert client.get("/api/backups", headers=auth).json()["last_auto_failure"] is None


def test_pg_dump_must_be_at_least_the_server_version(monkeypatch) -> None:
    class Done:
        def __init__(self, out: str) -> None:
            self.returncode, self.stdout = 0, out

    versions = {"old": "pg_dump (PostgreSQL) 15.4", "new": "pg_dump (PostgreSQL) 16.2"}
    monkeypatch.setattr(backup_service, "_server_major", lambda: 16)
    monkeypatch.setattr(backup_service, "_run", lambda argv, **kw: Done(versions[Path(argv[0]).name]))
    monkeypatch.setattr(backup_service, "_docker_running", lambda container: False)

    monkeypatch.setattr(backup_service, "_pg_dump_candidates", lambda: [Path("old"), Path("new")])
    argv, env = backup_service._dump_command()
    assert argv[0] == "new" and "--no-owner" in argv and "PGPASSWORD" in env

    monkeypatch.setattr(backup_service, "_pg_dump_candidates", lambda: [Path("old")])
    with pytest.raises(backup_service.BackupError, match="16"):
        backup_service._dump_command()


def test_backup_permissions(client: TestClient, auth, backup_dir: Path) -> None:
    roles = {r["code"]: r for r in client.get("/api/roles", headers=auth).json()}
    # The accountant gets everything but users, the letterhead — and backups.
    assert "settings.backup" not in roles["accountant"]["permissions"]
    keeper = client.post("/api/roles", headers=auth, json={"code": "keeper", "name": "أمين النسخ", "permissions": ["settings.backup"]}).json()

    def login(username: str, role_id: int) -> dict:
        client.post("/api/users", headers=auth, json={"username": username, "password": "secret123", "role_id": role_id})
        token = client.post("/api/auth/login", data={"username": username, "password": "secret123"}).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    accountant, holder = login("acc1", roles["accountant"]["id"]), login("keep1", keeper["id"])
    assert client.get("/api/backups", headers=accountant).status_code == 403
    assert client.post("/api/backups", headers=accountant).status_code == 403
    assert client.get("/api/backups", headers=holder).status_code == 200
    assert client.get("/api/backups").status_code == 401
