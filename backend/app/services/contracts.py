from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    Apartment,
    ApartmentStatus,
    Client,
    Contract,
    ContractStatus,
    ContractType,
    EntryType,
    JournalEntry,
    PaymentSchedule,
    ScheduleStatus,
    User,
)
from app.services import accounts as accounts_service
from app.services import ledger as ledger_service
from app.services.dates import add_months, months_between
from app.services.fx import CENTS

# Which apartment status each contract type implies once the contract is active.
_ACTIVE_UNIT_STATUS = {
    ContractType.sale: ApartmentStatus.sold,
    ContractType.rent: ApartmentStatus.rented,
}


def generate_schedule(db: Session, contract: Contract) -> list[PaymentSchedule]:
    """Build installment (sale) or rent-period rows for a contract.

    Replaces any existing rows that have not been paid against; refuses to
    rebuild once money has been allocated, so collections are never lost.
    """
    existing = db.scalars(
        select(PaymentSchedule).where(PaymentSchedule.contract_id == contract.id)
    ).all()
    if any(Decimal(row.paid_amount) > 0 for row in existing):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Schedule already has payments allocated — adjust the rows individually instead",
        )
    for row in existing:
        db.delete(row)
    db.flush()

    if contract.start_date is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Contract needs a start_date to build a schedule"
        )

    if contract.contract_type is ContractType.sale:
        rows = _sale_rows(contract)
    else:
        rows = _rent_rows(contract)

    db.add_all(rows)
    db.flush()
    return rows


def _sale_rows(contract: Contract) -> list[PaymentSchedule]:
    count = contract.installment_count or 0
    if count <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="installment_count must be greater than zero to build a sale schedule",
        )

    principal = Decimal(contract.total_amount or 0) - Decimal(contract.down_payment or 0)
    if principal < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="down_payment exceeds total_amount"
        )

    per = (principal / count).quantize(CENTS)
    rows: list[PaymentSchedule] = []
    for seq in range(1, count + 1):
        # The final installment absorbs the rounding residual so the schedule
        # sums exactly to the financed principal.
        amount = per if seq < count else principal - per * (count - 1)
        rows.append(
            PaymentSchedule(
                contract_id=contract.id,
                seq_no=seq,
                due_date=add_months(contract.start_date, seq, day=contract.billing_day),
                amount=amount,
                currency_id=contract.currency_id,
                status=ScheduleStatus.pending,
            )
        )
    return rows


def _rent_rows(contract: Contract) -> list[PaymentSchedule]:
    if contract.end_date is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Rent contracts need an end_date to build a schedule"
        )
    if contract.end_date < contract.start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="end_date must fall after start_date"
        )

    periods = months_between(contract.start_date, contract.end_date)
    rent = Decimal(contract.monthly_rent or 0)
    return [
        PaymentSchedule(
            contract_id=contract.id,
            seq_no=seq,
            due_date=add_months(contract.start_date, seq - 1, day=contract.billing_day),
            amount=rent,
            currency_id=contract.currency_id,
            status=ScheduleStatus.pending,
        )
        for seq in range(1, periods + 1)
    ]


def allocate_payment(db: Session, contract_id: int, amount: Decimal) -> Decimal:
    """Apply `amount` to the contract's schedule, oldest due date first.

    Returns whatever is left over (an overpayment), which stays on the client's
    account as a credit rather than being forced onto a future installment.
    """
    remaining = Decimal(amount)
    rows = db.scalars(
        select(PaymentSchedule)
        .where(
            PaymentSchedule.contract_id == contract_id,
            PaymentSchedule.status != ScheduleStatus.cancelled,
        )
        .order_by(PaymentSchedule.due_date, PaymentSchedule.seq_no)
    ).all()

    for row in rows:
        if remaining <= 0:
            break
        outstanding = Decimal(row.amount) - Decimal(row.paid_amount)
        if outstanding <= 0:
            continue
        applied = min(outstanding, remaining)
        row.paid_amount = Decimal(row.paid_amount) + applied
        remaining -= applied
        row.status = (
            ScheduleStatus.paid if Decimal(row.paid_amount) >= Decimal(row.amount) else ScheduleStatus.partial
        )

    db.flush()
    return remaining


def unallocate_payment(db: Session, contract_id: int, amount: Decimal) -> None:
    """Reverse an allocation (newest first) when a receipt is deleted."""
    remaining = Decimal(amount)
    rows = db.scalars(
        select(PaymentSchedule)
        .where(PaymentSchedule.contract_id == contract_id)
        .order_by(PaymentSchedule.due_date.desc(), PaymentSchedule.seq_no.desc())
    ).all()

    for row in rows:
        if remaining <= 0:
            break
        paid = Decimal(row.paid_amount)
        if paid <= 0:
            continue
        reversed_amount = min(paid, remaining)
        row.paid_amount = paid - reversed_amount
        remaining -= reversed_amount
        row.status = (
            ScheduleStatus.pending if Decimal(row.paid_amount) == 0 else ScheduleStatus.partial
        )
    db.flush()


def activate(db: Session, contract: Contract, user: User | None = None) -> Contract:
    """Move a draft contract to active: post the revenue entry, flag the unit.

    Sale  → Dr client receivable / Cr sales revenue for the full price.
    Rent  → no revenue yet; rent is recognised per period when invoiced.
    """
    if contract.status is not ContractStatus.draft:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Contract {contract.contract_no} is already {contract.status.value}",
        )

    client = db.get(Client, contract.client_id)
    if client is None or client.account_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Client has no receivable account — create one before activating the contract",
        )

    if contract.contract_type is ContractType.sale:
        revenue = accounts_service.by_code(db, settings.sales_revenue_code)
        ledger_service.simple_entry(
            db,
            entry_date=contract.sign_date or contract.start_date,
            entry_type=EntryType.sale,
            currency_id=contract.currency_id,
            debit_account_id=client.account_id,
            credit_account_id=revenue.id,
            amount=Decimal(contract.total_amount or 0),
            description=f"عقد بيع {contract.contract_no}",
            client_id=client.id,
            contract_id=contract.id,
            user=user,
        )

    apartment = db.get(Apartment, contract.apartment_id)
    if apartment is not None:
        apartment.status = _ACTIVE_UNIT_STATUS[contract.contract_type]

    contract.status = ContractStatus.active
    db.flush()
    return contract


def invoice_rent_period(
    db: Session, contract: Contract, row: PaymentSchedule, user: User | None = None
):
    """Recognise one rent period: Dr client receivable / Cr rent revenue."""
    client = db.get(Client, contract.client_id)
    if client is None or client.account_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Client has no receivable account"
        )

    revenue = accounts_service.by_code(db, settings.rent_revenue_code)
    return ledger_service.simple_entry(
        db,
        entry_date=row.due_date,
        entry_type=EntryType.rent_invoice,
        currency_id=row.currency_id,
        debit_account_id=client.account_id,
        credit_account_id=revenue.id,
        amount=Decimal(row.amount),
        description=f"إيجار {contract.contract_no} — دفعة {row.seq_no}",
        client_id=client.id,
        contract_id=contract.id,
        user=user,
    )


def already_invoiced(db: Session, contract_id: int, row: PaymentSchedule) -> JournalEntry | None:
    """The live rent invoice for this period, if one has been posted.

    Keyed on the period's due date, which is the date `invoice_rent_period`
    stamps on the entry. One invoice per period — a second would double the
    receivable.
    """
    return db.scalars(
        select(JournalEntry).where(
            JournalEntry.contract_id == contract_id,
            JournalEntry.entry_type == EntryType.rent_invoice,
            JournalEntry.entry_date == row.due_date,
            ~JournalEntry.is_deleted,
        )
    ).first()


@dataclass
class RentRun:
    entries: list[JournalEntry] = field(default_factory=list)
    skipped: int = 0
    # (contract_no, seq_no, reason)
    failures: list[tuple[str, int, str]] = field(default_factory=list)


def invoice_due_rent(db: Session, as_of: date, user: User | None = None) -> RentRun:
    """Invoice every rent period due on or before `as_of` that has no invoice yet.

    Active, live rent contracts only. Safe to re-run: a period that already
    carries an invoice is counted as skipped, never posted twice. Each period
    posts inside its own savepoint, so one contract that cannot be invoiced
    (no receivable account, no exchange rate for its currency) is reported and
    the rest of the run still goes through.
    """
    run = RentRun()
    pairs = db.execute(
        select(Contract, PaymentSchedule)
        .join(PaymentSchedule, PaymentSchedule.contract_id == Contract.id)
        .where(
            Contract.contract_type == ContractType.rent,
            Contract.status == ContractStatus.active,
            ~Contract.is_deleted,
            PaymentSchedule.status != ScheduleStatus.cancelled,
            PaymentSchedule.due_date <= as_of,
        )
        .order_by(Contract.contract_no, PaymentSchedule.due_date, PaymentSchedule.seq_no)
    ).all()

    for contract, row in pairs:
        if already_invoiced(db, contract.id, row) is not None:
            run.skipped += 1
            continue
        try:
            with db.begin_nested():
                run.entries.append(invoice_rent_period(db, contract, row, user))
        except HTTPException as exc:
            run.failures.append((contract.contract_no, row.seq_no, str(exc.detail)))
    return run


def refresh_overdue(db: Session, as_of: date) -> tuple[int, int]:
    """Write the `overdue` status that reads have so far only computed.

    pending → overdue once the due date has passed with nothing paid, on
    active live contracts. overdue → pending when the row is no longer late
    (its due date was moved, or the refresh is run for an earlier date).

    Part-paid rows keep `partial`: that status records that money arrived, and
    lateness is still computed on read. A payment moves an overdue row to
    partial/paid through `allocate_payment`; a voided receipt drops it back to
    pending until the next refresh. Returns (marked_overdue, cleared).
    """
    live = select(Contract.id).where(~Contract.is_deleted, Contract.status == ContractStatus.active)
    marked = db.execute(
        update(PaymentSchedule)
        .where(
            PaymentSchedule.status == ScheduleStatus.pending,
            PaymentSchedule.due_date < as_of,
            PaymentSchedule.amount > PaymentSchedule.paid_amount,
            PaymentSchedule.contract_id.in_(live),
        )
        .values(status=ScheduleStatus.overdue)
        .execution_options(synchronize_session=False)
    ).rowcount
    cleared = db.execute(
        update(PaymentSchedule)
        .where(PaymentSchedule.status == ScheduleStatus.overdue, PaymentSchedule.due_date >= as_of)
        .values(status=ScheduleStatus.pending)
        .execution_options(synchronize_session=False)
    ).rowcount
    return marked, cleared
