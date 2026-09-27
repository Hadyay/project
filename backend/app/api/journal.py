from datetime import UTC, date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.common import Paging, get_or_404, paginate
from app.core.deps import CurrentUser, DbSession, get_current_user, require_perm
from app.models import Account, EntryType, JournalEntry, JournalLine
from app.schemas.common import Message, Page
from app.schemas.ledger import (
    JournalEntryCreate,
    JournalEntryDetail,
    JournalEntryOut,
    JournalLineDetail,
    JournalLineOut,
)
from app.services import audit
from app.services import ledger as ledger_service

router = APIRouter(prefix="/api/journal", tags=["journal"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=Page[JournalEntryOut], dependencies=[Depends(require_perm("journal.view"))])
def list_entries(
    db: DbSession,
    paging: Paging,
    entry_type: EntryType | None = None,
    contract_id: int | None = None,
    account_id: int | None = None,
    client_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    posted_only: bool = False,
    q: str | None = None,
) -> Page[JournalEntryOut]:
    stmt = (
        select(JournalEntry)
        .where(~JournalEntry.is_deleted)
        .order_by(JournalEntry.entry_date.desc(), JournalEntry.id.desc())
    )
    if entry_type is not None:
        stmt = stmt.where(JournalEntry.entry_type == entry_type)
    if contract_id is not None:
        stmt = stmt.where(JournalEntry.contract_id == contract_id)
    # "which entries touched this account / this client" — the question the
    # ledger and statement screens drill down from.
    if account_id is not None:
        stmt = stmt.where(
            JournalEntry.id.in_(select(JournalLine.entry_id).where(JournalLine.account_id == account_id))
        )
    if client_id is not None:
        stmt = stmt.where(
            JournalEntry.id.in_(select(JournalLine.entry_id).where(JournalLine.client_id == client_id))
        )
    if date_from is not None:
        stmt = stmt.where(JournalEntry.entry_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(JournalEntry.entry_date <= date_to)
    if posted_only:
        stmt = stmt.where(JournalEntry.is_posted)
    if q:
        # An accountant looking for a document remembers the person, not the
        # entry number: "شور" has to find every entry that touched شور's
        # account, and "الصندوق" every entry that touched the till.
        like = f"%{q}%"
        by_name = select(JournalLine.entry_id).join(
            Account, Account.id == JournalLine.account_id
        ).where(Account.name_ar.ilike(like) | Account.code.ilike(like))
        stmt = stmt.where(
            JournalEntry.entry_no.ilike(like)
            | JournalEntry.description.ilike(like)
            | JournalEntry.id.in_(by_name)
            | JournalEntry.id.in_(
                select(JournalLine.entry_id).where(JournalLine.line_desc.ilike(like))
            )
        )

    rows, total = paginate(db, stmt, paging)
    return Page(
        items=[JournalEntryOut.model_validate(r) for r in rows],
        total=total,
        limit=paging.limit,
        offset=paging.offset,
    )


@router.get("/{entry_id}", response_model=JournalEntryDetail, dependencies=[Depends(require_perm("journal.view", "clients.view", "accounts.view"))])
def get_entry(db: DbSession, entry_id: int) -> JournalEntryDetail:
    entry = db.scalars(
        select(JournalEntry)
        .options(selectinload(JournalEntry.lines))
        .where(JournalEntry.id == entry_id, ~JournalEntry.is_deleted)
    ).one_or_none()
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journal entry not found")

    accounts = dict(
        db.execute(
            select(Account.id, Account.code).where(
                Account.id.in_([line.account_id for line in entry.lines])
            )
        ).all()
    )
    names = dict(
        db.execute(
            select(Account.id, Account.name_ar).where(
                Account.id.in_([line.account_id for line in entry.lines])
            )
        ).all()
    )

    lines = [
        JournalLineDetail(
            **JournalLineOut.model_validate(line).model_dump(),
            account_code=accounts.get(line.account_id),
            account_name=names.get(line.account_id),
        )
        for line in entry.lines
    ]

    return JournalEntryDetail(
        **JournalEntryOut.model_validate(entry).model_dump(),
        lines=lines,
        total_debit=sum((Decimal(line.debit_base) for line in entry.lines), Decimal(0)),
        total_credit=sum((Decimal(line.credit_base) for line in entry.lines), Decimal(0)),
    )


@router.post(
    "", response_model=JournalEntryOut, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_perm("journal.create"))],
)
def create_entry(db: DbSession, payload: JournalEntryCreate, user: CurrentUser) -> JournalEntry:
    """Manual قيد يومية. Balance is enforced by the schema and again in the DB."""
    if payload.entry_no and db.scalars(
        select(JournalEntry).where(JournalEntry.entry_no == payload.entry_no)
    ).one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Entry '{payload.entry_no}' already exists"
        )

    entry = ledger_service.create_entry(db, payload, user)
    audit.record(
        db, table="journal_entries", record_id=entry.id, action="insert", user=user, new=audit.snapshot(entry)
    )
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/{entry_id}/post", response_model=JournalEntryOut, dependencies=[Depends(require_perm("journal.post"))])
def post_entry(db: DbSession, entry_id: int, user: CurrentUser) -> JournalEntry:
    entry = get_or_404(db, JournalEntry, entry_id, name="Journal entry")
    ledger_service.post_entry(db, entry)
    audit.record(
        db, table="journal_entries", record_id=entry.id, action="update", user=user,
        new={"is_posted": True},
    )
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{entry_id}", response_model=Message, dependencies=[Depends(require_perm("journal.void"))])
def delete_entry(db: DbSession, entry_id: int, user: CurrentUser) -> Message:
    """Soft-delete an entry. Posted entries stay in the DB but drop out of reports."""
    entry = get_or_404(db, JournalEntry, entry_id, name="Journal entry")

    linked = db.scalars(
        select(JournalLine).where(JournalLine.entry_id == entry.id).limit(1)
    ).first()
    if entry.entry_type in {EntryType.receipt, EntryType.payment} and linked is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This entry belongs to a receipt or payment — void that document instead",
        )

    before = audit.snapshot(entry)
    entry.is_deleted = True
    entry.deleted_at = datetime.now(UTC)
    entry.deleted_by = user.id
    audit.record(
        db, table="journal_entries", record_id=entry.id, action="delete", user=user,
        old=before, new=audit.snapshot(entry),
    )
    db.commit()
    return Message(detail=f"Entry {entry.entry_no} deleted")
