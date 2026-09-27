"""جدول الدفعات — the monthly payment grid, built from the receipts.

The imported ledger has no contracts (the old system had none), so the
schedule the office reads is: each client × each month — paid, short, unpaid.
The rule is app/services/collection.py, shared with the reminders and the
dashboard ring."""

from datetime import date

from fastapi import APIRouter, Depends, Query

from app.core.deps import DbSession, get_current_user, require_perm
from app.schemas.reports import GridCell, GridRow, GridTotal, PaymentGrid
from app.services import collection, reminders

router = APIRouter(prefix="/api/schedule", tags=["schedule"], dependencies=[Depends(get_current_user)])


@router.get("/grid", response_model=PaymentGrid, dependencies=[Depends(require_perm("schedule.view", "receipts.view"))])
def payment_grid(
    db: DbSession,
    year: int | None = Query(default=None, ge=2000, le=2100),
    as_of: date | None = None,
    q: str | None = None,
    only_late: bool = False,
    project: str | None = None,
) -> PaymentGrid:
    as_of = as_of or date.today()
    year = year or as_of.year
    late_ids = {row.client_id for row in reminders.compute(db, as_of).rows}
    windows, rows, totals = collection.grid(db, year, as_of, late_ids, q=q, only_late=only_late, project=project)
    projects = sorted({c.project for c in collection.Snapshot(db, as_of).clients if c.project})
    return PaymentGrid(
        year=year,
        as_of=as_of,
        months=[w.period for w in windows],
        projects=projects,
        rows=[
            GridRow(
                client_id=r.client_id,
                code=r.code,
                name=r.name,
                phone=r.phone,
                project=r.project,
                block=r.block,
                balance=r.balance,
                monthly_installment=r.monthly_installment,
                first_charge_date=r.first_charge_date,
                late=r.late,
                late_months=r.late_months,
                cells=[GridCell(**c.__dict__) for c in r.cells],
                total_paid=r.total_paid,
            )
            for r in rows
        ],
        totals=[GridTotal(**t.__dict__) for t in totals],
    )
