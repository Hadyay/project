"""Database backups — الإعدادات ← النسخ الاحتياطي.

Each backup is one dated, plain-SQL `pg_dump` of the whole database in
`db_backup/` (settings.backup_path): the ledger, users, roles, letterhead,
everything. It is the same format `scripts/backup-db.ps1` writes, so
`setup.bat -Force -Backup db_backup\\<file>` restores any of them as it is.

Two ways a backup is made:
  * on demand — the button in the settings tab (`create("manual")`);
  * automatically — the API itself, once it has run for a minute, and then
    every hour checks whether the newest backup is older than
    `backup_every_hours`. The data only changes while the app runs, so this
    covers every day the office works without a Windows scheduled task.

A file only becomes a backup once pg_dump has exited cleanly *and* its tail
carries pg_dump's closing line; until then it is `<name>.part`. So a crash,
a full disk or a killed process never leaves something that looks like a
backup but restores half a ledger.

Old ones are pruned: older than `backup_keep_days`, but never the newest
`backup_keep_min` — an office closed for six weeks still has a week of
history when it reopens. Only files matching NAME are ever touched.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

from app.config import settings

log = logging.getLogger(__name__)

NAME = re.compile(r"^erp_backup_(\d{4}-\d{2}-\d{2}_\d{6})_(auto|manual)\.sql$")
STAMP = "%Y-%m-%d_%H%M%S"
DUMP_ARGS = ["--no-owner", "--no-privileges", "--encoding=UTF8", "--quote-all-identifiers"]
END_MARK = b"-- PostgreSQL database dump complete"
TIMEOUT_SECONDS = 600
# No console window flashing up on Windows each time pg_dump runs.
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

_lock = threading.Lock()
_scheduler: threading.Thread | None = None


class BackupError(Exception):
    """A backup could not be made; the message is shown to the user as is."""


class BackupBusy(BackupError):
    pass


@dataclass
class BackupFile:
    name: str
    created_at: datetime  # local time, from the file name
    size: int
    kind: str  # "auto" | "manual"


@dataclass
class AutoFailure:
    at: datetime
    message: str


# The last automatic run that failed, until one succeeds — shown in the tab,
# because a backup that silently stopped working is the worst kind.
last_auto_failure: AutoFailure | None = None


def folder() -> Path:
    return settings.backup_path


def path_of(name: str) -> Path | None:
    """The file for a backup name, or None — the name must be one of ours, so
    a request can never reach outside the folder."""
    if not NAME.match(name):
        return None
    path = folder() / name
    return path if path.is_file() else None


def _describe(path: Path) -> BackupFile | None:
    match = NAME.match(path.name)
    if not match:
        return None
    return BackupFile(
        name=path.name,
        created_at=datetime.strptime(match.group(1), STAMP),
        size=path.stat().st_size,
        kind=match.group(2),
    )


def list_backups() -> list[BackupFile]:
    """Newest first."""
    if not folder().is_dir():
        return []
    found = [_describe(p) for p in folder().iterdir() if p.is_file()]
    return sorted((f for f in found if f), key=lambda f: f.created_at, reverse=True)


def next_due(now: datetime | None = None) -> datetime:
    newest = next(iter(list_backups()), None)
    if newest is None:
        return now or datetime.now()
    return newest.created_at + timedelta(hours=settings.backup_every_hours)


# ----------------------------------------------------------------- pg_dump


def _version_major(text: str) -> int | None:
    match = re.search(r"(\d+)(?:\.\d+)?", text)
    return int(match.group(1)) if match else None


def _server_major() -> int:
    engine = create_engine(settings.database_url)
    try:
        with engine.connect() as conn:
            return int(conn.exec_driver_sql("SHOW server_version_num").scalar()) // 10000
    finally:
        engine.dispose()


def _pg_dump_candidates() -> list[Path]:
    found: list[Path] = []
    if settings.backup_pg_dump:
        found.append(Path(settings.backup_pg_dump))
    on_path = shutil.which("pg_dump")
    if on_path:
        found.append(Path(on_path))
    base = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "PostgreSQL"
    installed = sorted(base.glob("*/bin/pg_dump.exe"), key=lambda p: _version_major(p.parent.parent.name) or 0, reverse=True)
    found.extend(installed)
    unique: list[Path] = []
    for p in found:
        if p.is_file() and p.resolve() not in {u.resolve() for u in unique}:
            unique.append(p)
    return unique


def _run(argv: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(argv, creationflags=NO_WINDOW, **kwargs)


def _docker_running(container: str) -> bool:
    if not container or not shutil.which("docker"):
        return False
    try:
        state = _run(["docker", "inspect", "-f", "{{.State.Running}}", container], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return state.returncode == 0 and state.stdout.strip() == "true"


def _dump_command() -> tuple[list[str], dict[str, str]]:
    """How to run pg_dump against this database: a local pg_dump at least as new
    as the server (older ones refuse), else the dev PC's Docker container."""
    url = make_url(settings.database_url)
    server = _server_major()
    for exe in _pg_dump_candidates():
        try:
            out = _run([str(exe), "--version"], capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.TimeoutExpired):
            continue
        major = _version_major(out.stdout)
        if out.returncode == 0 and major and major >= server:
            env = {**os.environ, "PGPASSWORD": url.password or ""}
            argv = [str(exe), "-h", url.host or "localhost", "-p", str(url.port or 5432),
                    "-U", url.username or "postgres", "-d", url.database or "", *DUMP_ARGS]
            return argv, env
    container = settings.backup_docker_container
    if _docker_running(container):
        argv = ["docker", "exec", container, "pg_dump", "-U", url.username or "postgres", "-d", url.database or "", *DUMP_ARGS]
        return argv, dict(os.environ)
    raise BackupError(
        f"لم يُعثر على pg_dump بإصدار {server} أو أحدث — ثبّت أدوات PostgreSQL {server}، "
        "أو اكتب مساره في BACKUP_PG_DUMP داخل backend\\.env"
    )


def _complete(path: Path) -> bool:
    with open(path, "rb") as f:
        f.seek(max(0, path.stat().st_size - 4096))
        return END_MARK in f.read()


# ----------------------------------------------------------------- create / prune


def create(kind: str = "manual") -> BackupFile:
    """Make one backup now. Raises BackupBusy if one is already being made."""
    if kind not in ("auto", "manual"):
        raise ValueError(kind)
    if not _lock.acquire(blocking=False):
        raise BackupBusy("نسخة احتياطية قيد الإنشاء الآن — انتظر لحظة ثم أعد المحاولة")
    try:
        target = folder()
        target.mkdir(parents=True, exist_ok=True)
        name = f"erp_backup_{datetime.now():{STAMP}}_{kind}.sql"
        final = target / name
        partial = target / f"{name}.part"
        argv, env = _dump_command()
        try:
            with open(partial, "wb") as out:
                done = _run(argv, stdout=out, stderr=subprocess.PIPE, env=env, timeout=TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            partial.unlink(missing_ok=True)
            raise BackupError("استغرق النسخ الاحتياطي أكثر من ١٠ دقائق فأُوقف") from None
        except OSError as exc:
            partial.unlink(missing_ok=True)
            raise BackupError(f"تعذّر تشغيل pg_dump: {exc}") from None
        if done.returncode != 0:
            partial.unlink(missing_ok=True)
            detail = done.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or [""]
            raise BackupError(f"فشل pg_dump: {detail[0]}")
        if not _complete(partial):
            partial.unlink(missing_ok=True)
            raise BackupError("النسخة لم تكتمل — لم تُحفظ")
        partial.replace(final)
        prune()
        described = _describe(final)
        assert described is not None
        return described
    finally:
        _lock.release()


def prune(now: datetime | None = None) -> list[str]:
    """Delete backups older than backup_keep_days, never the newest
    backup_keep_min; and `.part` leftovers of a run that died a day ago."""
    now = now or datetime.now()
    cutoff = now - timedelta(days=settings.backup_keep_days)
    removed: list[str] = []
    for index, backup in enumerate(list_backups()):
        if index >= settings.backup_keep_min and backup.created_at < cutoff:
            (folder() / backup.name).unlink(missing_ok=True)
            removed.append(backup.name)
    if folder().is_dir():
        for leftover in folder().glob("erp_backup_*.sql.part"):
            if datetime.fromtimestamp(leftover.stat().st_mtime) < now - timedelta(days=1):
                leftover.unlink(missing_ok=True)
    return removed


# ----------------------------------------------------------------- automatic


def run_if_due() -> BackupFile | None:
    global last_auto_failure
    now = datetime.now()
    if now < next_due(now):
        return None
    try:
        made = create("auto")
    except BackupBusy:
        return None
    except Exception as exc:  # noqa: BLE001 — recorded and shown, never allowed to kill the loop
        last_auto_failure = AutoFailure(at=datetime.now(), message=str(exc))
        log.exception("automatic backup failed")
        return None
    last_auto_failure = None
    log.info("automatic backup written: %s", made.name)
    return made


def _loop() -> None:
    time.sleep(60)  # let the API finish starting first
    while True:
        run_if_due()
        time.sleep(3600)


def start_scheduler() -> None:
    """Called once when the API starts (app.main lifespan)."""
    global _scheduler
    if not settings.backup_auto or (_scheduler and _scheduler.is_alive()):
        return
    _scheduler = threading.Thread(target=_loop, name="erp-backup", daemon=True)
    _scheduler.start()
