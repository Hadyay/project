"""النسخ الاحتياطي — list, make and download database backups.

A backup holds everything, every user's password hash included, so all three
routes need `settings.backup`, which only the system role holds by default.
Making and downloading one are recorded in audit_log.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from app.config import settings
from app.core.deps import CurrentUser, DbSession, get_current_user, require_perm
from app.schemas.backups import BackupFailure, BackupItem, BackupStatus
from app.services import audit
from app.services import backup as backup_service

router = APIRouter(
    prefix="/api/backups",
    tags=["backups"],
    dependencies=[Depends(get_current_user), Depends(require_perm("settings.backup"))],
)


def _item(b: backup_service.BackupFile) -> BackupItem:
    return BackupItem(name=b.name, created_at=b.created_at, size_bytes=b.size, kind=b.kind)


@router.get("", response_model=BackupStatus)
def backup_status() -> BackupStatus:
    items = backup_service.list_backups()
    failure = backup_service.last_auto_failure
    return BackupStatus(
        folder=str(backup_service.folder()),
        auto_enabled=settings.backup_auto,
        every_hours=settings.backup_every_hours,
        keep_days=settings.backup_keep_days,
        keep_min=settings.backup_keep_min,
        latest_at=items[0].created_at if items else None,
        next_due_at=backup_service.next_due() if settings.backup_auto else None,
        last_auto_failure=BackupFailure(at=failure.at, message=failure.message) if failure else None,
        total_bytes=sum(b.size for b in items),
        items=[_item(b) for b in items],
    )


@router.post("", response_model=BackupItem, status_code=status.HTTP_201_CREATED)
def create_backup(db: DbSession, user: CurrentUser) -> BackupItem:
    """Back up now. Takes a few seconds; a second click meanwhile gets 409."""
    try:
        made = backup_service.create("manual")
    except backup_service.BackupBusy as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from None
    except backup_service.BackupError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from None
    audit.record(db, table="backups", record_id=0, action="insert", user=user,
                 new={"file": made.name, "size": made.size})
    db.commit()
    return _item(made)


@router.get("/{name}", response_class=FileResponse)
def download_backup(name: str, db: DbSession, user: CurrentUser) -> FileResponse:
    path = backup_service.path_of(name)
    if path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="النسخة غير موجودة")
    audit.record(db, table="backups", record_id=0, action="export", user=user, new={"file": name})
    db.commit()
    return FileResponse(path, media_type="application/sql", filename=name)
