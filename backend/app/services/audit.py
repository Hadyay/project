from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog, Base, User


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    return value


def snapshot(row: Base, *, skip: set[str] | None = None) -> dict[str, Any]:
    """Column values of a model row, converted to JSON-safe primitives."""
    skip = skip or set()
    return {
        column.name: _jsonable(getattr(row, column.name))
        for column in row.__table__.columns
        if column.name not in skip
    }


def record(
    db: Session,
    *,
    table: str,
    record_id: int,
    action: str,
    user: User | None = None,
    old: dict[str, Any] | None = None,
    new: dict[str, Any] | None = None,
) -> AuditLog:
    """Append one row to audit_log. Written inside the caller's transaction."""
    log = AuditLog(
        table_name=table,
        record_id=record_id,
        action=action,
        changed_by=user.id if user else None,
        old_values=old,
        new_values=new,
    )
    db.add(log)
    return log
