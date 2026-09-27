from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.common import Paging, apply_updates, get_or_404, paginate
from app.config import settings
from app.core.deps import CurrentUser, DbSession, get_current_user, require_perm
from app.models import (
    Account,
    Client,
    Contract,
    ContractStatus,
    Currency,
    EntryType,
    JournalEntry,
    JournalLine,
    Payment,
    Receipt,
)
from app.schemas.clients import (
    ClientBalance,
    ClientCreate,
    ClientListItem,
    ClientOut,
    ClientStatement,
    ClientUpdate,
    StatementLine,
)
from app.schemas.common import Message, Page
from app.services import accounts as accounts_service
from app.services import audit, reminders

router = APIRouter(prefix="/api/clients", tags=["clients"], dependencies=[Depends(get_current_user)])


def _account_balances():
    """Each account's balance in base currency, voided entries excluded.

    The entry filter sits on an inner join inside the subquery: filtering
    `is_deleted` on an outer join only nulls the entry columns and leaves the
    amounts counting — the bug v_trial_balance once had.
    """
    return (
        select(
            JournalLine.account_id,
            func.sum(JournalLine.debit_base - JournalLine.credit_base).label("balance"),
        )
        .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
        .where(~JournalEntry.is_deleted)
        .group_by(JournalLine.account_id)
        .subquery()
    )


@router.get("", response_model=Page[ClientListItem], dependencies=[Depends(require_perm("clients.view", "receipts.view", "receipts.create", "contracts.view", "contracts.create", "reports.view"))])
def list_clients(
    db: DbSession,
    paging: Paging,
    q: str | None = None,
    balance: Literal["debit", "credit", "zero"] | None = None,
    sort: Literal["name", "balance_desc", "balance_asc"] = "name",
) -> Page[ClientListItem]:
    """العملاء with their balances. `balance`: debit = owes, credit = paid ahead, zero = settled."""
    balances = _account_balances()
    amount = func.coalesce(balances.c.balance, 0)

    stmt = (
        select(Client)
        .outerjoin(balances, balances.c.account_id == Client.account_id)
        .where(~Client.is_deleted)
    )
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Client.name_ar.ilike(like)
            | Client.name_en.ilike(like)
            | Client.code.ilike(like)
            | Client.phone.ilike(like)
            | Client.national_id.ilike(like)
            | Client.project.ilike(like)
            | Client.block.ilike(like)
        )
    if balance == "debit":
        stmt = stmt.where(amount > 0)
    elif balance == "credit":
        stmt = stmt.where(amount < 0)
    elif balance == "zero":
        stmt = stmt.where(amount == 0)

    if sort == "balance_desc":
        stmt = stmt.order_by(amount.desc(), Client.name_ar)
    elif sort == "balance_asc":
        stmt = stmt.order_by(amount.asc(), Client.name_ar)
    else:
        stmt = stmt.order_by(Client.name_ar)

    rows, total = paginate(db, stmt, paging)

    account_ids = [r.account_id for r in rows if r.account_id is not None]
    by_account: dict[int, Decimal] = (
        dict(
            db.execute(
                select(balances.c.account_id, balances.c.balance).where(
                    balances.c.account_id.in_(account_ids)
                )
            ).all()
        )
        if account_ids
        else {}
    )
    late = {row.client_id: row for row in reminders.compute(db).rows}
    return Page(
        items=[
            ClientListItem(
                **ClientOut.model_validate(r).model_dump(),
                balance_base=Decimal(by_account.get(r.account_id) or 0),
                late=r.id in late,
                months_unpaid=late[r.id].months_unpaid if r.id in late else None,
            )
            for r in rows
        ],
        total=total,
        limit=paging.limit,
        offset=paging.offset,
    )


@router.get("/{client_id}", response_model=ClientOut, dependencies=[Depends(require_perm("clients.view", "receipts.view", "contracts.view"))])
def get_client(db: DbSession, client_id: int) -> Client:
    return get_or_404(db, Client, client_id, name="Client")


@router.post(
    "", response_model=ClientOut, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_perm("clients.create"))],
)
def create_client(db: DbSession, payload: ClientCreate, user: CurrentUser) -> Client:
    data = payload.model_dump(exclude={"create_account"})

    if data.get("email") is not None:
        data["email"] = str(data["email"])
    if data.get("code") and db.scalars(select(Client).where(Client.code == data["code"])).one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Client code '{data['code']}' already exists"
        )

    # Each client gets one receivable sub-account, mirroring the old system's
    # 411… numbering, unless the caller pointed at an existing account.
    if data.get("account_id") is None and payload.create_account:
        parent = accounts_service.by_code(db, settings.receivable_parent_code)
        account = accounts_service.create_client_account(db, parent, payload.name_ar, payload.name_en)
        data["account_id"] = account.id

    client = Client(**data, created_by=user.id)
    db.add(client)
    db.flush()
    audit.record(db, table="clients", record_id=client.id, action="insert", user=user, new=audit.snapshot(client))
    db.commit()
    db.refresh(client)
    return client


@router.patch("/{client_id}", response_model=ClientOut, dependencies=[Depends(require_perm("clients.edit"))])
def update_client(db: DbSession, client_id: int, payload: ClientUpdate, user: CurrentUser) -> Client:
    client = get_or_404(db, Client, client_id, name="Client")
    before = audit.snapshot(client)

    changes = apply_updates(client, payload)
    if changes.get("email") is not None:
        client.email = str(client.email)

    audit.record(
        db, table="clients", record_id=client.id, action="update", user=user,
        old=before, new=audit.snapshot(client),
    )
    db.commit()
    db.refresh(client)
    return client


@router.delete("/{client_id}", response_model=Message, dependencies=[Depends(require_perm("clients.delete"))])
def delete_client(db: DbSession, client_id: int, user: CurrentUser) -> Message:
    client = get_or_404(db, Client, client_id, name="Client")

    open_contracts = db.scalar(
        select(func.count()).select_from(Contract).where(
            Contract.client_id == client.id,
            ~Contract.is_deleted,
            Contract.status.in_([ContractStatus.draft, ContractStatus.active]),
        )
    )
    if open_contracts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Client has {open_contracts} open contract(s) — close them first",
        )

    before = audit.snapshot(client)
    client.is_deleted = True
    client.deleted_at = datetime.now(UTC)
    client.deleted_by = user.id
    audit.record(
        db, table="clients", record_id=client.id, action="delete", user=user,
        old=before, new=audit.snapshot(client),
    )
    db.commit()
    return Message(detail=f"Client {client.name_ar} deleted")


@router.get("/{client_id}/balance", response_model=ClientBalance, dependencies=[Depends(require_perm("clients.view"))])
def client_balance(db: DbSession, client_id: int) -> ClientBalance:
    """Totals shown on the client card: مدين / دائن / عدد الحركات / آخر دفعة."""
    client = get_or_404(db, Client, client_id, name="Client")

    debit, credit, count = db.execute(
        select(
            func.coalesce(func.sum(JournalLine.debit_base), 0),
            func.coalesce(func.sum(JournalLine.credit_base), 0),
            func.count(JournalLine.id),
        )
        .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
        .where(JournalLine.account_id == client.account_id, ~JournalEntry.is_deleted)
    ).one()

    last_payment = db.scalar(
        select(func.max(Receipt.receipt_date)).where(Receipt.client_id == client.id, ~Receipt.is_deleted)
    )

    return ClientBalance(
        client_id=client.id,
        total_debit=debit,
        total_credit=credit,
        balance=Decimal(debit) - Decimal(credit),
        entry_count=count,
        last_payment_date=last_payment,
    )


def _counterpart_names(db: Session, entry_ids: set[int], account_id: int) -> dict[int, str]:
    """The other accounts in each entry — "against what" every row was booked."""
    if not entry_ids:
        return {}
    rows = db.execute(
        select(JournalLine.entry_id, Account.name_ar)
        .join(Account, Account.id == JournalLine.account_id)
        .where(JournalLine.entry_id.in_(entry_ids), JournalLine.account_id != account_id)
        .order_by(JournalLine.entry_id, JournalLine.id)
    ).all()
    names: dict[int, list[str]] = {}
    for entry_id, name in rows:
        bucket = names.setdefault(entry_id, [])
        if name not in bucket:
            bucket.append(name)
    return {entry_id: "، ".join(bucket) for entry_id, bucket in names.items()}


def _document_numbers(db: Session, entry_ids: set[int]) -> dict[int, str]:
    """Receipt or payment number behind an entry, when one raised it - the
    printed voucher number where there is one (what the client's paper says),
    else the system number."""
    if not entry_ids:
        return {}
    documents = dict(
        db.execute(
            select(Receipt.journal_entry_id, func.coalesce(Receipt.ref_no, Receipt.receipt_no)).where(
                Receipt.journal_entry_id.in_(entry_ids), ~Receipt.is_deleted
            )
        ).all()
    )
    documents.update(
        db.execute(
            select(Payment.journal_entry_id, func.coalesce(Payment.ref_no, Payment.payment_no)).where(
                Payment.journal_entry_id.in_(entry_ids), ~Payment.is_deleted
            )
        ).all()
    )
    return documents


@router.get("/{client_id}/statement", response_model=ClientStatement, dependencies=[Depends(require_perm("clients.view"))])
def client_statement(
    db: DbSession,
    client_id: int,
    date_from: date | None = None,
    date_to: date | None = None,
) -> ClientStatement:
    """كشف حساب — ledger lines on the client's account with a running balance.

    Anything before `date_from` is folded into the opening balance so the
    running total stays correct when the statement is filtered by period.
    """
    client = get_or_404(db, Client, client_id, name="Client")
    if client.account_id is None:
        return ClientStatement(
            client=ClientOut.model_validate(client),
            opening_balance=Decimal(0),
            lines=[],
            closing_balance=Decimal(0),
        )

    base = (
        select(
            JournalEntry.id,
            JournalEntry.entry_date,
            JournalEntry.entry_no,
            JournalEntry.entry_type,
            JournalLine.line_desc,
            JournalLine.debit,
            JournalLine.credit,
            JournalLine.debit_base,
            JournalLine.credit_base,
            Currency.code,
        )
        .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
        .join(Currency, Currency.id == JournalEntry.currency_id)
        .where(JournalLine.account_id == client.account_id, ~JournalEntry.is_deleted)
        .order_by(JournalEntry.entry_date, JournalEntry.id, JournalLine.id)
    )

    opening = Decimal(0)
    if date_from is not None:
        prior_debit, prior_credit = db.execute(
            select(
                func.coalesce(func.sum(JournalLine.debit_base), 0),
                func.coalesce(func.sum(JournalLine.credit_base), 0),
            )
            .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
            .where(
                JournalLine.account_id == client.account_id,
                ~JournalEntry.is_deleted,
                JournalEntry.entry_date < date_from,
            )
        ).one()
        opening = Decimal(prior_debit) - Decimal(prior_credit)
        base = base.where(JournalEntry.entry_date >= date_from)
    if date_to is not None:
        base = base.where(JournalEntry.entry_date <= date_to)

    rows = db.execute(base).all()
    entry_ids = {row[0] for row in rows}
    counterparts = _counterpart_names(db, entry_ids, client.account_id)
    documents = _document_numbers(db, entry_ids)

    running = opening
    lines: list[StatementLine] = []
    for (
        entry_id, entry_date, entry_no, entry_type, desc, debit, credit, debit_base, credit_base, currency
    ) in rows:
        running += Decimal(debit_base) - Decimal(credit_base)
        lines.append(
            StatementLine(
                entry_id=entry_id,
                entry_date=entry_date,
                entry_no=entry_no,
                entry_type=EntryType(entry_type),
                line_desc=desc,
                counterpart=counterparts.get(entry_id),
                document_no=documents.get(entry_id),
                currency_code=currency,
                debit=debit,
                credit=credit,
                debit_base=debit_base,
                credit_base=credit_base,
                running_balance_base=running,
            )
        )

    return ClientStatement(
        client=ClientOut.model_validate(client),
        opening_balance=opening,
        lines=lines,
        closing_balance=running,
    )
