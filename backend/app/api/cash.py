from datetime import UTC, date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.api.common import Paging, get_or_404, paginate
from app.core.deps import CurrentUser, DbSession, get_current_user, require_perm
from app.models import (
    Account,
    Client,
    Contract,
    Currency,
    JournalEntry,
    Payment,
    PaymentMethod,
    Receipt,
)
from app.schemas.cash import (
    BulkReceiptCreate,
    BulkReceiptCreated,
    BulkReceiptFailure,
    BulkReceiptResult,
    PaymentCreate,
    PaymentDetail,
    PaymentOut,
    ReceiptCreate,
    ReceiptDetail,
    ReceiptOut,
)
from app.schemas.common import Message, Page
from app.services import audit
from app.services import cash as cash_service
from app.services import contracts as contracts_service
from app.services import fx

receipts_router = APIRouter(
    prefix="/api/receipts", tags=["receipts"], dependencies=[Depends(get_current_user)]
)
payments_router = APIRouter(
    prefix="/api/payments", tags=["payments"], dependencies=[Depends(get_current_user)]
)


@receipts_router.get("", response_model=Page[ReceiptDetail], dependencies=[Depends(require_perm("receipts.view", "reports.view"))])
def list_receipts(
    db: DbSession,
    paging: Paging,
    client_id: int | None = None,
    contract_id: int | None = None,
    cash_account_id: int | None = None,
    method: PaymentMethod | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    min_amount: Decimal | None = None,
    max_amount: Decimal | None = None,
    q: str | None = None,
) -> Page[ReceiptDetail]:
    stmt = (
        select(Receipt)
        .where(~Receipt.is_deleted)
        .order_by(Receipt.receipt_date.desc(), Receipt.id.desc())
    )
    if client_id is not None:
        stmt = stmt.where(Receipt.client_id == client_id)
    if contract_id is not None:
        stmt = stmt.where(Receipt.contract_id == contract_id)
    if cash_account_id is not None:
        stmt = stmt.where(Receipt.cash_account_id == cash_account_id)
    if method is not None:
        stmt = stmt.where(Receipt.method == method)
    if date_from is not None:
        stmt = stmt.where(Receipt.receipt_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(Receipt.receipt_date <= date_to)
    if min_amount is not None:
        stmt = stmt.where(Receipt.amount >= min_amount)
    if max_amount is not None:
        stmt = stmt.where(Receipt.amount <= max_amount)
    if q:
        # One search box over the three things a clerk actually remembers: the
        # receipt number, who paid, and what the note said.
        like = f"%{q}%"
        stmt = stmt.where(
            Receipt.receipt_no.ilike(like)
            | Receipt.ref_no.ilike(like)
            | Receipt.notes.ilike(like)
            | Receipt.cheque_no.ilike(like)
            | Receipt.client_id.in_(select(Client.id).where(Client.name_ar.ilike(like)))
        )

    rows, total = paginate(db, stmt, paging)

    clients = dict(db.execute(select(Client.id, Client.name_ar)).all())
    currencies = dict(db.execute(select(Currency.id, Currency.code)).all())
    accounts = dict(db.execute(select(Account.id, Account.name_ar)).all())
    contract_nos = dict(db.execute(select(Contract.id, Contract.contract_no)).all())

    items = [
        ReceiptDetail(
            **ReceiptOut.model_validate(r).model_dump(),
            client_name=clients.get(r.client_id),
            contract_no=contract_nos.get(r.contract_id),
            currency_code=currencies.get(r.currency_id),
            cash_account_name=accounts.get(r.cash_account_id),
        )
        for r in rows
    ]
    return Page(items=items, total=total, limit=paging.limit, offset=paging.offset)


@receipts_router.get("/{receipt_id}", response_model=ReceiptDetail, dependencies=[Depends(require_perm("receipts.view"))])
def get_receipt(db: DbSession, receipt_id: int) -> ReceiptDetail:
    """One receipt with the names filled in — what the printable voucher needs."""
    receipt = get_or_404(db, Receipt, receipt_id, name="Receipt")
    client = db.get(Client, receipt.client_id)
    return ReceiptDetail(
        **ReceiptOut.model_validate(receipt).model_dump(),
        client_name=client.name_ar if client else None,
        client_code=client.code if client else None,
        contract_no=(
            db.scalar(select(Contract.contract_no).where(Contract.id == receipt.contract_id))
            if receipt.contract_id
            else None
        ),
        currency_code=db.scalar(select(Currency.code).where(Currency.id == receipt.currency_id)),
        currency_name=db.scalar(select(Currency.name_ar).where(Currency.id == receipt.currency_id)),
        cash_account_name=db.scalar(
            select(Account.name_ar).where(Account.id == receipt.cash_account_id)
        ),
    )


@receipts_router.post(
    "", response_model=ReceiptOut, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_perm("receipts.create"))],
)
def create_receipt(db: DbSession, payload: ReceiptCreate, user: CurrentUser) -> Receipt:
    """قبض — money in, posted to the GL and allocated to the schedule."""
    if payload.contract_id is not None:
        contract = get_or_404(db, Contract, payload.contract_id, name="Contract")
        if contract.client_id != payload.client_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Contract belongs to a different client",
            )

    receipt = cash_service.create_receipt(db, payload, user)
    audit.record(
        db, table="receipts", record_id=receipt.id, action="insert", user=user, new=audit.snapshot(receipt)
    )
    db.commit()
    db.refresh(receipt)
    return receipt


@receipts_router.post(
    "/bulk", response_model=BulkReceiptResult, dependencies=[Depends(require_perm("receipts.create"))],
)
def create_receipts_bulk(db: DbSession, payload: BulkReceiptCreate, user: CurrentUser) -> BulkReceiptResult:
    """Many receipts at once. What every line shares — the till, the currency,
    its rate on that date — is checked first, so a wrong till is one 400 and
    nothing written. Each line then goes through the single-receipt path (GL,
    allocation, audit) in its own savepoint: a line that fails (unknown
    client, a contract of someone else) is reported and the rest are kept."""
    cash_service.cash_account(db, payload.cash_account_id)
    if db.get(Currency, payload.currency_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown currency_id {payload.currency_id}")
    if payload.post and payload.exchange_rate is None:
        fx.rate_for(db, payload.currency_id, payload.receipt_date)

    created: list[BulkReceiptCreated] = []
    failures: list[BulkReceiptFailure] = []
    for index, line in enumerate(payload.lines):
        try:
            with db.begin_nested():
                if line.contract_id is not None:
                    contract = db.get(Contract, line.contract_id)
                    if contract is None or contract.is_deleted or contract.client_id != line.client_id:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST, detail="العقد لا يخص هذا العميل"
                        )
                receipt = cash_service.create_receipt(
                    db,
                    ReceiptCreate(
                        receipt_date=payload.receipt_date,
                        client_id=line.client_id,
                        contract_id=line.contract_id,
                        cash_account_id=payload.cash_account_id,
                        amount=line.amount,
                        currency_id=payload.currency_id,
                        exchange_rate=payload.exchange_rate,
                        method=payload.method,
                        cheque_no=line.cheque_no,
                        ref_no=line.ref_no,
                        notes=line.notes,
                        post=payload.post,
                    ),
                    user,
                )
                audit.record(
                    db, table="receipts", record_id=receipt.id, action="insert", user=user,
                    new=audit.snapshot(receipt),
                )
        except HTTPException as exc:
            failures.append(BulkReceiptFailure(line=index, client_id=line.client_id, detail=str(exc.detail)))
            continue
        created.append(
            BulkReceiptCreated(
                line=index, client_id=line.client_id, receipt_id=receipt.id,
                receipt_no=receipt.receipt_no, amount=Decimal(receipt.amount),
            )
        )

    db.commit()
    return BulkReceiptResult(
        created=created,
        failures=failures,
        count=len(created),
        total_amount=sum((c.amount for c in created), Decimal(0)),
    )


@receipts_router.delete(
    "/{receipt_id}", response_model=Message, dependencies=[Depends(require_perm("receipts.void"))]
)
def delete_receipt(db: DbSession, receipt_id: int, user: CurrentUser) -> Message:
    """Void a receipt: reverse the allocation and soft-delete its GL entry."""
    receipt = get_or_404(db, Receipt, receipt_id, name="Receipt")
    before = audit.snapshot(receipt)

    if receipt.contract_id is not None:
        contracts_service.unallocate_payment(db, receipt.contract_id, Decimal(receipt.amount))

    if receipt.journal_entry_id is not None:
        entry = db.get(JournalEntry, receipt.journal_entry_id)
        if entry is not None:
            entry.is_deleted = True
            entry.deleted_at = datetime.now(UTC)
            entry.deleted_by = user.id

    receipt.is_deleted = True
    receipt.deleted_at = datetime.now(UTC)
    receipt.deleted_by = user.id

    audit.record(
        db, table="receipts", record_id=receipt.id, action="delete", user=user,
        old=before, new=audit.snapshot(receipt),
    )
    db.commit()
    return Message(detail=f"Receipt {receipt.receipt_no} voided")


# -------------------------------------------------------------------- payments


@payments_router.get("", response_model=Page[PaymentDetail], dependencies=[Depends(require_perm("payments.view", "reports.view"))])
def list_payments(
    db: DbSession,
    paging: Paging,
    beneficiary_account_id: int | None = None,
    cash_account_id: int | None = None,
    method: PaymentMethod | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    min_amount: Decimal | None = None,
    max_amount: Decimal | None = None,
    q: str | None = None,
) -> Page[PaymentDetail]:
    stmt = (
        select(Payment)
        .where(~Payment.is_deleted)
        .order_by(Payment.payment_date.desc(), Payment.id.desc())
    )
    if beneficiary_account_id is not None:
        stmt = stmt.where(Payment.beneficiary_account_id == beneficiary_account_id)
    if cash_account_id is not None:
        stmt = stmt.where(Payment.cash_account_id == cash_account_id)
    if method is not None:
        stmt = stmt.where(Payment.method == method)
    if date_from is not None:
        stmt = stmt.where(Payment.payment_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(Payment.payment_date <= date_to)
    if min_amount is not None:
        stmt = stmt.where(Payment.amount >= min_amount)
    if max_amount is not None:
        stmt = stmt.where(Payment.amount <= max_amount)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Payment.payment_no.ilike(like)
            | Payment.ref_no.ilike(like)
            | Payment.notes.ilike(like)
            | Payment.cheque_no.ilike(like)
            | Payment.beneficiary_account_id.in_(
                select(Account.id).where(Account.name_ar.ilike(like))
            )
        )

    rows, total = paginate(db, stmt, paging)

    accounts = dict(db.execute(select(Account.id, Account.name_ar)).all())
    currencies = dict(db.execute(select(Currency.id, Currency.code)).all())

    items = [
        PaymentDetail(
            **PaymentOut.model_validate(r).model_dump(),
            beneficiary_name=accounts.get(r.beneficiary_account_id),
            currency_code=currencies.get(r.currency_id),
            cash_account_name=accounts.get(r.cash_account_id),
        )
        for r in rows
    ]
    return Page(items=items, total=total, limit=paging.limit, offset=paging.offset)


@payments_router.get("/{payment_id}", response_model=PaymentDetail, dependencies=[Depends(require_perm("payments.view"))])
def get_payment(db: DbSession, payment_id: int) -> PaymentDetail:
    """One payment with the names filled in — what the printable voucher needs."""
    payment = get_or_404(db, Payment, payment_id, name="Payment")
    return PaymentDetail(
        **PaymentOut.model_validate(payment).model_dump(),
        beneficiary_name=db.scalar(
            select(Account.name_ar).where(Account.id == payment.beneficiary_account_id)
        ),
        currency_code=db.scalar(select(Currency.code).where(Currency.id == payment.currency_id)),
        currency_name=db.scalar(select(Currency.name_ar).where(Currency.id == payment.currency_id)),
        cash_account_name=db.scalar(
            select(Account.name_ar).where(Account.id == payment.cash_account_id)
        ),
    )


@payments_router.post(
    "", response_model=PaymentOut, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_perm("payments.create"))],
)
def create_payment(db: DbSession, payload: PaymentCreate, user: CurrentUser) -> Payment:
    """صرف — money out, posted to the GL."""
    payment = cash_service.create_payment(db, payload, user)
    audit.record(
        db, table="payments", record_id=payment.id, action="insert", user=user, new=audit.snapshot(payment)
    )
    db.commit()
    db.refresh(payment)
    return payment


@payments_router.delete(
    "/{payment_id}", response_model=Message, dependencies=[Depends(require_perm("payments.void"))]
)
def delete_payment(db: DbSession, payment_id: int, user: CurrentUser) -> Message:
    payment = get_or_404(db, Payment, payment_id, name="Payment")
    before = audit.snapshot(payment)

    if payment.journal_entry_id is not None:
        entry = db.get(JournalEntry, payment.journal_entry_id)
        if entry is not None:
            entry.is_deleted = True
            entry.deleted_at = datetime.now(UTC)
            entry.deleted_by = user.id

    payment.is_deleted = True
    payment.deleted_at = datetime.now(UTC)
    payment.deleted_by = user.id

    audit.record(
        db, table="payments", record_id=payment.id, action="delete", user=user,
        old=before, new=audit.snapshot(payment),
    )
    db.commit()
    return Message(detail=f"Payment {payment.payment_no} voided")
