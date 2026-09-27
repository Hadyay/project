from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select

from app.api.common import Paging, paginate
from app.core.deps import CurrentUser, DbSession, get_current_user, require_perm
from app.models import Account, AccountType, JournalEntry, JournalLine
from app.schemas.accounts import (
    AccountCreate,
    AccountOut,
    AccountTreeNode,
    AccountUpdate,
    TrialBalanceRow,
)
from app.schemas.common import Page
from app.services import audit

router = APIRouter(prefix="/api/accounts", tags=["accounts"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=Page[AccountOut], dependencies=[Depends(require_perm("accounts.view", "journal.view", "journal.create", "receipts.view", "receipts.create", "payments.view", "payments.create", "reports.view"))])
def list_accounts(
    db: DbSession,
    paging: Paging,
    q: str | None = None,
    account_type: str | None = None,
    is_client: bool | None = None,
    is_cash_bank: bool | None = None,
    postable_only: bool = False,
) -> Page[AccountOut]:
    stmt = select(Account).order_by(Account.code)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Account.code.ilike(like) | Account.name_ar.ilike(like) | Account.name_en.ilike(like))
    if account_type:
        stmt = stmt.where(Account.account_type == account_type)
    if is_client is not None:
        stmt = stmt.where(Account.is_client == is_client)
    if is_cash_bank is not None:
        stmt = stmt.where(Account.is_cash_bank == is_cash_bank)
    if postable_only:
        stmt = stmt.where(Account.is_postable)

    rows, total = paginate(db, stmt, paging)
    return Page(
        items=[AccountOut.model_validate(r) for r in rows],
        total=total,
        limit=paging.limit,
        offset=paging.offset,
    )


@router.get("/tree", response_model=list[AccountTreeNode], dependencies=[Depends(require_perm("accounts.view", "reports.view"))])
def account_tree(db: DbSession) -> list[AccountTreeNode]:
    """Whole chart of accounts nested by parent — drives دليل الحسابات."""
    rows = db.scalars(select(Account).order_by(Account.code)).all()
    # Validate through AccountOut, which has no `children` field. Validating the
    # row as an AccountTreeNode directly reads the ORM `children` backref, which
    # lazy-loads each subtree (a query per account) and pre-fills children that
    # the loop below then appends again — every node repeated once per level of
    # depth. On the legacy chart that turned 594 accounts into 1,035 rows.
    nodes = {
        row.id: AccountTreeNode(**AccountOut.model_validate(row).model_dump()) for row in rows
    }

    roots: list[AccountTreeNode] = []
    for row in rows:
        node = nodes[row.id]
        parent = nodes.get(row.parent_id) if row.parent_id else None
        if parent is None:
            roots.append(node)
        else:
            parent.children.append(node)
    return roots


@router.get("/trial-balance", response_model=list[TrialBalanceRow], dependencies=[Depends(require_perm("reports.view", "accounts.view"))])
def trial_balance(
    db: DbSession,
    nonzero_only: bool = True,
    date_from: date | None = None,
    date_to: date | None = None,
    account_type: AccountType | None = None,
) -> list[TrialBalanceRow]:
    """ميزان المراجعة — net debit/credit per account in base currency.

    With dates, it is the movement *within* the period rather than the
    all-time balance — the shape a monthly ميزان takes.
    """
    # Which lines count is decided *inside* a subquery, with an inner join.
    # Putting `NOT is_deleted` (or a date) on an outer join to journal_entries
    # does not drop the line — it only nulls the entry columns, so a voided
    # entry's amounts would keep showing up in the totals.
    lines = (
        select(
            JournalLine.account_id.label("account_id"),
            JournalLine.debit_base.label("debit_base"),
            JournalLine.credit_base.label("credit_base"),
        )
        .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
        .where(~JournalEntry.is_deleted)
    )
    if date_from is not None:
        lines = lines.where(JournalEntry.entry_date >= date_from)
    if date_to is not None:
        lines = lines.where(JournalEntry.entry_date <= date_to)
    movement = lines.subquery("movement")

    debit = func.coalesce(func.sum(movement.c.debit_base), 0)
    credit = func.coalesce(func.sum(movement.c.credit_base), 0)

    # The join back to accounts stays outer so that `nonzero_only=false` still
    # means "every account", including the ones that never moved.
    stmt = (
        select(Account.id, Account.code, Account.name_ar, debit, credit)
        .join(movement, movement.c.account_id == Account.id, isouter=True)
        .group_by(Account.id, Account.code, Account.name_ar)
        .order_by(Account.code)
    )
    if account_type is not None:
        stmt = stmt.where(Account.account_type == account_type)

    rows = [
        TrialBalanceRow(
            account_id=account_id,
            code=code,
            name_ar=name,
            total_debit=total_debit,
            total_credit=total_credit,
            balance=total_debit - total_credit,
        )
        for account_id, code, name, total_debit, total_credit in db.execute(stmt).all()
    ]
    if nonzero_only:
        rows = [r for r in rows if r.total_debit or r.total_credit]
    return rows


@router.get("/{account_id}", response_model=AccountOut, dependencies=[Depends(require_perm("accounts.view", "reports.view", "journal.view"))])
def get_account(db: DbSession, account_id: int) -> Account:
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return account


@router.post(
    "", response_model=AccountOut, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_perm("accounts.create"))],
)
def create_account(db: DbSession, payload: AccountCreate, user: CurrentUser) -> Account:
    if db.scalars(select(Account).where(Account.code == payload.code)).one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Account code '{payload.code}' already exists"
        )
    if payload.parent_id is not None and db.get(Account, payload.parent_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown parent account")

    account = Account(**payload.model_dump())
    db.add(account)
    db.flush()
    audit.record(db, table="accounts", record_id=account.id, action="insert", user=user, new=audit.snapshot(account))
    db.commit()
    db.refresh(account)
    return account


@router.patch("/{account_id}", response_model=AccountOut, dependencies=[Depends(require_perm("accounts.edit"))])
def update_account(db: DbSession, account_id: int, payload: AccountUpdate, user: CurrentUser) -> Account:
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    before = audit.snapshot(account)
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("parent_id") == account.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="An account cannot be its own parent"
        )
    for field, value in changes.items():
        setattr(account, field, value)

    audit.record(
        db, table="accounts", record_id=account.id, action="update", user=user,
        old=before, new=audit.snapshot(account),
    )
    db.commit()
    db.refresh(account)
    return account
