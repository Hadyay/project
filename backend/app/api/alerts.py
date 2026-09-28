"""التنبيهات — the monthly payment reminder. See app/services/reminders.py."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select

from app.api.common import get_or_404
from app.core.deps import CurrentUser, DbSession, get_current_user, require_perm
from app.models import Client, ClientReminder
from app.schemas.alerts import (
    AlertSettingsOut,
    AlertSettingsUpdate,
    AlertsReport,
    AlertsSummary,
    BulkRemind,
    BulkRemindResult,
    CycleOut,
    LateClientOut,
    ReminderMark,
)
from app.schemas.common import Message
from app.services import audit, reminders

router = APIRouter(prefix="/api/alerts", tags=["alerts"], dependencies=[Depends(get_current_user)])


def _report(db, as_of: date | None) -> AlertsReport:
    report = reminders.compute(db, as_of)
    return AlertsReport(
        enabled=report.enabled,
        alert_day=report.alert_day,
        min_balance=report.min_balance,
        as_of=report.as_of,
        cycle=CycleOut(**report.cycle.__dict__),
        count=len(report.rows),
        reminded_count=report.reminded_count,
        total_balance=report.total_balance,
        rows=[LateClientOut(**row.__dict__) for row in report.rows],
    )


@router.get("", response_model=AlertsReport, dependencies=[Depends(require_perm("alerts.view"))])
def list_alerts(db: DbSession, as_of: date | None = None) -> AlertsReport:
    """Every client late in the cycle in force on `as_of` (default today)."""
    return _report(db, as_of)


@router.get(
    "/summary",
    response_model=AlertsSummary,
    dependencies=[Depends(require_perm("alerts.view", "dashboard.view"))],
)
def alerts_summary(db: DbSession, as_of: date | None = None) -> AlertsSummary:
    report = reminders.compute(db, as_of)
    return AlertsSummary(
        enabled=report.enabled,
        alert_day=report.alert_day,
        period=report.cycle.period,
        alert_date=report.cycle.alert_date,
        is_alert_day=report.cycle.is_alert_day,
        count=len(report.rows),
        reminded_count=report.reminded_count,
        total_balance=report.total_balance,
    )


@router.get(
    "/clients/{client_id}",
    response_model=LateClientOut | None,
    dependencies=[Depends(require_perm("alerts.view", "clients.view"))],
)
def client_alert(db: DbSession, client_id: int, as_of: date | None = None) -> LateClientOut | None:
    """One client's status for the cycle — null when they are not late."""
    report = reminders.compute(db, as_of, client_id=client_id)
    return LateClientOut(**report.rows[0].__dict__) if report.rows else None


def _current_period(db) -> str:
    return reminders.cycle_for(date.today(), reminders.settings_row(db).alert_day).period


def _mark(db, client_id: int, period: str, note: str | None, user) -> None:
    """Record (or re-record) that the office reminded this client in `period`."""
    mark = db.scalars(
        select(ClientReminder).where(ClientReminder.client_id == client_id, ClientReminder.period == period)
    ).one_or_none()
    if mark is None:
        mark = ClientReminder(client_id=client_id, period=period)
        db.add(mark)
    mark.note = note
    mark.reminded_by = user.id
    mark.reminded_at = func.now()
    db.flush()
    audit.record(db, table="client_reminders", record_id=mark.id, action="insert", user=user,
                 old=None, new={"client_id": client_id, "period": period, "note": note})


@router.post(
    "/clients/{client_id}/remind",
    response_model=Message,
    dependencies=[Depends(require_perm("alerts.manage"))],
)
def mark_reminded(db: DbSession, client_id: int, payload: ReminderMark, user: CurrentUser) -> Message:
    """Note that the office reminded this client in the current cycle."""
    get_or_404(db, Client, client_id, name="Client")
    period = _current_period(db)
    _mark(db, client_id, period, payload.note, user)
    db.commit()
    return Message(detail=f"تم تسجيل التذكير لشهر {period}")


@router.post(
    "/remind/bulk",
    response_model=BulkRemindResult,
    dependencies=[Depends(require_perm("alerts.manage"))],
)
def mark_reminded_bulk(db: DbSession, payload: BulkRemind, user: CurrentUser) -> BulkRemindResult:
    """Mark many clients reminded in the current cycle at once — after a round
    of calls down the red list. Ids that are not (live) clients are returned
    in `missing` rather than failing the rest."""
    period = _current_period(db)
    wanted = list(dict.fromkeys(payload.client_ids))
    live = set(db.scalars(select(Client.id).where(Client.id.in_(wanted), ~Client.is_deleted)))
    for client_id in wanted:
        if client_id in live:
            _mark(db, client_id, period, payload.note, user)
    db.commit()
    return BulkRemindResult(
        period=period, count=len(live), missing=[i for i in wanted if i not in live]
    )


@router.delete(
    "/clients/{client_id}/remind",
    response_model=Message,
    dependencies=[Depends(require_perm("alerts.manage"))],
)
def unmark_reminded(db: DbSession, client_id: int, user: CurrentUser) -> Message:
    period = _current_period(db)
    mark = db.scalars(
        select(ClientReminder).where(ClientReminder.client_id == client_id, ClientReminder.period == period)
    ).one_or_none()
    if mark is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="لا تذكير مسجّل لهذا الشهر")
    audit.record(db, table="client_reminders", record_id=mark.id, action="delete", user=user,
                 old={"client_id": client_id, "period": period, "note": mark.note}, new=None)
    db.delete(mark)
    db.commit()
    return Message(detail="أُلغي تسجيل التذكير")


@router.get(
    "/settings",
    response_model=AlertSettingsOut,
    dependencies=[Depends(require_perm("alerts.view", "settings.alerts"))],
)
def get_settings(db: DbSession) -> AlertSettingsOut:
    row = reminders.settings_row(db)
    db.commit()
    return AlertSettingsOut.model_validate(row)


@router.put("/settings", response_model=AlertSettingsOut, dependencies=[Depends(require_perm("settings.alerts"))])
def update_settings(db: DbSession, payload: AlertSettingsUpdate, user: CurrentUser) -> AlertSettingsOut:
    row = reminders.settings_row(db)
    before = audit.snapshot(row)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    row.updated_by = user.id
    row.updated_at = func.now()
    db.flush()
    audit.record(db, table="alert_settings", record_id=1, action="update", user=user, old=before, new=audit.snapshot(row))
    db.commit()
    db.refresh(row)
    return AlertSettingsOut.model_validate(row)
