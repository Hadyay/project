from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class BackupItem(BaseModel):
    name: str
    created_at: datetime  # the server PC's local time
    size_bytes: int
    kind: Literal["auto", "manual"]


class BackupFailure(BaseModel):
    at: datetime
    message: str


class BackupStatus(BaseModel):
    folder: str
    auto_enabled: bool
    every_hours: int
    keep_days: int
    keep_min: int
    latest_at: datetime | None
    next_due_at: datetime | None  # null when automatic backups are off
    last_auto_failure: BackupFailure | None
    total_bytes: int
    items: list[BackupItem]
