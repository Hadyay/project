from datetime import UTC, date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.common import Paging, apply_updates, get_or_404, paginate
from app.core.deps import CurrentUser, DbSession, get_current_user, require_perm
from app.models import (
    Apartment,
    ApartmentStatus,
    Building,
    Client,
    Contract,
    ContractStatus,
    ContractType,
    Currency,
    EntryType,
    JournalEntry,
    PaymentSchedule,
    ScheduleStatus,
)
from app.schemas.common import Message, Page
from app.schemas.contracts import (
    ContractCreate,
    ContractDetail,
    ContractOut,
    ContractUpdate,
    OverdueRefresh,
    OverdueRow,
    RentInvoiceFailure,
    RentInvoiceRun,
    ScheduleRowOut,
    ScheduleRowUpdate,
)
from app.schemas.ledger import JournalEntryOut
from app.services import audit
from app.services import contracts as contracts_service

router = APIRouter(prefix="/api/contracts", tags=["contracts"], dependencies=[Depends(get_current_user)])

# Statuses a unit may be in when a new contract is written against it.
_BOOKABLE = {ApartmentStatus.available, ApartmentStatus.reserved}


def _schedule_totals(db: Session, contract_id: int) -> tuple[Decimal, Decimal]:
    due, paid = db.execute(
        select(
            func.coalesce(func.sum(PaymentSchedule.amount), 0),
            func.coalesce(func.sum(PaymentSchedule.paid_amount), 0),
        ).where(
            PaymentSchedule.contract_id == contract_id,
            PaymentSchedule.status != ScheduleStatus.cancelled,
        )
    ).one()
    return Decimal(paid), Decimal(due) - Decimal(paid)


@router.get("", response_model=Page[ContractOut], dependencies=[Depends(require_perm("contracts.view", "receipts.create", "clients.view"))])
def list_contracts(
    db: DbSession,
    paging: Paging,
    client_id: int | None = None,
    apartment_id: int | None = None,
    contract_type: ContractType | None = None,
    contract_status: ContractStatus | None = None,
    q: str | None = None,
) -> Page[ContractOut]:
    stmt = select(Contract).where(~Contract.is_deleted).order_by(Contract.sign_date.desc(), Contract.id.desc())
    if client_id is not None:
        stmt = stmt.where(Contract.client_id == client_id)
    if apartment_id is not None:
        stmt = stmt.where(Contract.apartment_id == apartment_id)
    if contract_type is not None:
        stmt = stmt.where(Contract.contract_type == contract_type)
    if contract_status is not None:
        stmt = stmt.where(Contract.status == contract_status)
    if q:
        # Contracts are looked up by who signed them as often as by number.
        like = f"%{q}%"
        stmt = stmt.where(
            Contract.contract_no.ilike(like)
            | Contract.client_id.in_(select(Client.id).where(Client.name_ar.ilike(like)))
            | Contract.apartment_id.in_(
                select(Apartment.id).where(Apartment.unit_no.ilike(like))
            )
        )

    rows, total = paginate(db, stmt, paging)
    return Page(
        items=[ContractOut.model_validate(r) for r in rows],
        total=total,
        limit=paging.limit,
        offset=paging.offset,
    )


@router.get("/overdue", response_model=list[OverdueRow], dependencies=[Depends(require_perm("schedule.view", "dashboard.view"))])
def overdue(db: DbSession, as_of: date | None = None, limit: int = 200) -> list[OverdueRow]:
    """Late installments and rent — what each client owes and how late it is."""
    cutoff = as_of or date.today()

    rows = db.execute(
        select(
            PaymentSchedule.id,
            Contract.contract_no,
            Contract.contract_type,
            Client.id,
            Client.name_ar,
            PaymentSchedule.due_date,
            PaymentSchedule.amount,
            PaymentSchedule.paid_amount,
        )
        .join(Contract, Contract.id == PaymentSchedule.contract_id)
        .join(Client, Client.id == Contract.client_id)
        .where(
            ~Contract.is_deleted,
            PaymentSchedule.status.in_(
                [ScheduleStatus.pending, ScheduleStatus.partial, ScheduleStatus.overdue]
            ),
            PaymentSchedule.due_date < cutoff,
            PaymentSchedule.amount > PaymentSchedule.paid_amount,
        )
        .order_by(PaymentSchedule.due_date)
        .limit(limit)
    ).all()

    return [
        OverdueRow(
            id=row_id,
            contract_no=contract_no,
            contract_type=contract_type,
            client_id=client_id,
            client_name=client_name,
            due_date=due_date,
            amount=amount,
            paid_amount=paid,
            outstanding=Decimal(amount) - Decimal(paid),
            days_late=(cutoff - due_date).days,
        )
        for row_id, contract_no, contract_type, client_id, client_name, due_date, amount, paid in rows
    ]


@router.post(
    "/rent/invoice-due", response_model=RentInvoiceRun, dependencies=[Depends(require_perm("schedule.manage"))]
)
def invoice_due_rent(db: DbSession, user: CurrentUser, as_of: date | None = None) -> RentInvoiceRun:
    """Invoice every rent period due by `as_of` (default today) that has no invoice.

    The batch form of `/{id}/schedule/{row}/invoice`. Re-running it is safe:
    periods already invoiced are skipped, not posted twice.
    """
    cutoff = as_of or date.today()
    run = contracts_service.invoice_due_rent(db, cutoff, user)
    db.commit()
    return RentInvoiceRun(
        as_of=cutoff,
        invoiced=len(run.entries),
        skipped=run.skipped,
        entry_nos=[entry.entry_no for entry in run.entries],
        failures=[
            RentInvoiceFailure(contract_no=no, seq_no=seq, detail=detail)
            for no, seq, detail in run.failures
        ],
    )


@router.post(
    "/schedule/refresh-overdue", response_model=OverdueRefresh, dependencies=[Depends(require_perm("schedule.manage"))]
)
def refresh_overdue(db: DbSession, as_of: date | None = None) -> OverdueRefresh:
    """Flag unpaid installments past due as `overdue` (and un-flag any no longer late)."""
    cutoff = as_of or date.today()
    marked, cleared = contracts_service.refresh_overdue(db, cutoff)
    db.commit()
    return OverdueRefresh(as_of=cutoff, marked_overdue=marked, cleared=cleared)


@router.get("/{contract_id}", response_model=ContractDetail, dependencies=[Depends(require_perm("contracts.view"))])
def get_contract(db: DbSession, contract_id: int) -> ContractDetail:
    contract = get_or_404(db, Contract, contract_id, name="Contract")

    client = db.get(Client, contract.client_id)
    apartment = db.get(Apartment, contract.apartment_id)
    building = db.get(Building, apartment.building_id) if apartment else None
    currency = db.get(Currency, contract.currency_id)
    paid, outstanding = _schedule_totals(db, contract.id)

    return ContractDetail(
        **ContractOut.model_validate(contract).model_dump(),
        client_name=client.name_ar if client else None,
        building_name=building.name if building else None,
        unit_no=apartment.unit_no if apartment else None,
        currency_code=currency.code if currency else None,
        paid_total=paid,
        outstanding_total=outstanding,
    )


@router.post(
    "", response_model=ContractOut, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_perm("contracts.create"))],
)
def create_contract(db: DbSession, payload: ContractCreate, user: CurrentUser) -> Contract:
    get_or_404(db, Client, payload.client_id, name="Client")
    apartment = get_or_404(db, Apartment, payload.apartment_id, name="Apartment")

    if apartment.status not in _BOOKABLE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Unit {apartment.unit_no} is {apartment.status.value} and cannot be contracted",
        )
    if db.scalars(select(Contract).where(Contract.contract_no == payload.contract_no)).one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Contract '{payload.contract_no}' already exists"
        )

    contract = Contract(**payload.model_dump(exclude={"generate_schedule"}), created_by=user.id)
    db.add(contract)
    db.flush()

    if payload.generate_schedule:
        contracts_service.generate_schedule(db, contract)

    audit.record(
        db, table="contracts", record_id=contract.id, action="insert", user=user, new=audit.snapshot(contract)
    )
    db.commit()
    db.refresh(contract)
    return contract


@router.patch("/{contract_id}", response_model=ContractOut, dependencies=[Depends(require_perm("contracts.edit"))])
def update_contract(db: DbSession, contract_id: int, payload: ContractUpdate, user: CurrentUser) -> Contract:
    contract = get_or_404(db, Contract, contract_id, name="Contract")
    before = audit.snapshot(contract)
    apply_updates(contract, payload)
    audit.record(
        db, table="contracts", record_id=contract.id, action="update", user=user,
        old=before, new=audit.snapshot(contract),
    )
    db.commit()
    db.refresh(contract)
    return contract


@router.post(
    "/{contract_id}/activate", response_model=ContractOut, dependencies=[Depends(require_perm("contracts.activate"))]
)
def activate_contract(db: DbSession, contract_id: int, user: CurrentUser) -> Contract:
    """Draft → active: post the sale entry and flag the unit sold/rented."""
    contract = get_or_404(db, Contract, contract_id, name="Contract")
    contracts_service.activate(db, contract, user)
    audit.record(
        db, table="contracts", record_id=contract.id, action="update", user=user,
        new={"status": contract.status.value},
    )
    db.commit()
    db.refresh(contract)
    return contract


@router.delete("/{contract_id}", response_model=Message, dependencies=[Depends(require_perm("contracts.delete"))])
def delete_contract(db: DbSession, contract_id: int, user: CurrentUser) -> Message:
    contract = get_or_404(db, Contract, contract_id, name="Contract")

    paid, _ = _schedule_totals(db, contract.id)
    if paid > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Contract has collections against it — cancel or terminate it instead of deleting",
        )

    before = audit.snapshot(contract)
    contract.is_deleted = True
    contract.deleted_at = datetime.now(UTC)
    contract.deleted_by = user.id
    contract.status = ContractStatus.cancelled

    apartment = db.get(Apartment, contract.apartment_id)
    if apartment is not None and apartment.status in {ApartmentStatus.sold, ApartmentStatus.rented}:
        apartment.status = ApartmentStatus.available

    audit.record(
        db, table="contracts", record_id=contract.id, action="delete", user=user,
        old=before, new=audit.snapshot(contract),
    )
    db.commit()
    return Message(detail=f"Contract {contract.contract_no} deleted")


# ------------------------------------------------------------------- schedule


@router.get("/{contract_id}/schedule", response_model=list[ScheduleRowOut], dependencies=[Depends(require_perm("contracts.view", "schedule.view"))])
def get_schedule(db: DbSession, contract_id: int) -> list[PaymentSchedule]:
    get_or_404(db, Contract, contract_id, name="Contract")
    return list(
        db.scalars(
            select(PaymentSchedule)
            .where(PaymentSchedule.contract_id == contract_id)
            .order_by(PaymentSchedule.seq_no)
        ).all()
    )


@router.post(
    "/{contract_id}/schedule/generate",
    response_model=list[ScheduleRowOut],
    dependencies=[Depends(require_perm("schedule.manage"))],
)
def regenerate_schedule(db: DbSession, contract_id: int) -> list[PaymentSchedule]:
    contract = get_or_404(db, Contract, contract_id, name="Contract")
    rows = contracts_service.generate_schedule(db, contract)
    db.commit()
    return rows


@router.patch(
    "/{contract_id}/schedule/{row_id}",
    response_model=ScheduleRowOut,
    dependencies=[Depends(require_perm("schedule.manage"))],
)
def update_schedule_row(
    db: DbSession, contract_id: int, row_id: int, payload: ScheduleRowUpdate
) -> PaymentSchedule:
    row = db.get(PaymentSchedule, row_id)
    if row is None or row.contract_id != contract_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule row not found")

    changes = payload.model_dump(exclude_unset=True)
    if "amount" in changes and Decimal(changes["amount"]) < Decimal(row.paid_amount):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Amount cannot drop below what has already been paid on this row",
        )
    for field, value in changes.items():
        setattr(row, field, value)

    db.commit()
    db.refresh(row)
    return row


@router.post(
    "/{contract_id}/schedule/{row_id}/invoice",
    response_model=JournalEntryOut,
    dependencies=[Depends(require_perm("schedule.manage"))],
)
def invoice_period(db: DbSession, contract_id: int, row_id: int, user: CurrentUser) -> JournalEntryOut:
    """Recognise one rent period in the GL (Dr client / Cr rent revenue)."""
    contract = get_or_404(db, Contract, contract_id, name="Contract")
    if contract.contract_type is not ContractType.rent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Only rent contracts are invoiced per period"
        )

    row = db.get(PaymentSchedule, row_id)
    if row is None or row.contract_id != contract_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule row not found")

    # One rent invoice per period — re-posting would double the receivable.
    already = contracts_service.already_invoiced(db, contract_id, row)
    if already is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Period {row.seq_no} is already invoiced as {already.entry_no}",
        )

    entry = contracts_service.invoice_rent_period(db, contract, row, user)
    db.commit()
    db.refresh(entry)
    return JournalEntryOut.model_validate(entry)
