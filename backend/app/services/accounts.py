from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, AccountType


def by_code(db: Session, code: str) -> Account:
    account = db.scalars(select(Account).where(Account.code == code)).one_or_none()
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account '{code}' is missing — run the seed script or fix the chart of accounts",
        )
    return account


def next_child_code(db: Session, parent: Account, width: int = 4) -> str:
    """Next free code under `parent`, e.g. 4110 → 41100001, 41100002, …

    The suffix width follows whatever the existing children use: the imported
    legacy chart numbers its customers 411 + five digits, and minting a
    four-digit 4110219 next to 41100218 would leave the tree in two shapes.
    `width` is only the fallback for a parent with no numbered children yet.
    Sequencing is numeric, not lexicographic, for the same reason.
    """
    codes = db.scalars(
        select(Account.code).where(
            Account.parent_id == parent.id, Account.code.like(f"{parent.code}_%")
        )
    ).all()
    suffixes = [code[len(parent.code) :] for code in codes]
    numbered = [s for s in suffixes if s.isdigit()]

    seq = 0
    if numbered:
        width = max(len(s) for s in numbered)
        seq = max(int(s) for s in numbered)
    return f"{parent.code}{seq + 1:0{width}d}"


def create_client_account(db: Session, parent: Account, name_ar: str, name_en: str | None = None) -> Account:
    """One receivable sub-account per client, the way the old system did it."""
    account = Account(
        code=next_child_code(db, parent),
        name_ar=name_ar,
        name_en=name_en,
        parent_id=parent.id,
        account_type=AccountType.asset,
        is_client=True,
        is_postable=True,
    )
    db.add(account)
    db.flush()
    return account


def ensure_postable(account: Account) -> Account:
    if not account.is_postable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account {account.code} is a header account and cannot take entries",
        )
    return account
