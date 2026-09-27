from datetime import date
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, EntryType, JournalEntry, JournalLine, User
from app.schemas.ledger import JournalEntryCreate, JournalLineIn
from app.services import fx
from app.services.numbering import next_number

ENTRY_PREFIX = "JE-"


def _load_postable_accounts(db: Session, account_ids: set[int]) -> dict[int, Account]:
    accounts = {
        a.id: a for a in db.scalars(select(Account).where(Account.id.in_(account_ids))).all()
    }
    missing = account_ids - accounts.keys()
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown account_id(s): {sorted(missing)}",
        )
    not_postable = [a.code for a in accounts.values() if not a.is_postable]
    if not_postable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account(s) {not_postable} are headers and cannot take entries",
        )
    return accounts


def _base_amounts(lines: list[JournalLineIn], rate: Decimal) -> list[tuple[Decimal, Decimal]]:
    """Per-line (debit_base, credit_base), forced to balance after rounding.

    Rounding each line independently can leave the base-currency totals a cent
    apart, which the DB's balance trigger rejects. The residual is absorbed by
    the largest line on the heavier side.
    """
    converted = [(fx.to_base(line.debit, rate), fx.to_base(line.credit, rate)) for line in lines]

    debit_total = sum((d for d, _ in converted), Decimal(0))
    credit_total = sum((c for _, c in converted), Decimal(0))
    residual = debit_total - credit_total
    if residual == 0:
        return converted

    # Residual > 0 means debits are heavy: shave the biggest debit line (and
    # vice versa) so the entry balances to the cent.
    index, _ = max(
        ((i, pair[0] if residual > 0 else pair[1]) for i, pair in enumerate(converted)),
        key=lambda item: item[1],
    )
    debit, credit = converted[index]
    if residual > 0:
        converted[index] = (debit - residual, credit)
    else:
        converted[index] = (debit, credit + residual)
    return converted


def create_entry(
    db: Session,
    data: JournalEntryCreate,
    user: User | None = None,
    *,
    flush: bool = True,
) -> JournalEntry:
    """Build a balanced journal entry with both transaction and base amounts.

    Does not commit — the caller owns the transaction, so a receipt and its GL
    posting land together or not at all.
    """
    rate = data.exchange_rate or fx.rate_for(db, data.currency_id, data.entry_date)
    _load_postable_accounts(db, {line.account_id for line in data.lines})

    entry = JournalEntry(
        entry_no=data.entry_no or next_number(db, JournalEntry.entry_no, ENTRY_PREFIX),
        entry_date=data.entry_date,
        entry_type=data.entry_type,
        description=data.description,
        contract_id=data.contract_id,
        currency_id=data.currency_id,
        exchange_rate=rate,
        is_posted=data.is_posted,
        created_by=user.id if user else None,
    )

    for line, (debit_base, credit_base) in zip(data.lines, _base_amounts(data.lines, rate), strict=True):
        entry.lines.append(
            JournalLine(
                account_id=line.account_id,
                client_id=line.client_id,
                debit=line.debit,
                credit=line.credit,
                debit_base=debit_base,
                credit_base=credit_base,
                line_desc=line.line_desc,
            )
        )

    db.add(entry)
    if flush:
        db.flush()
    return entry


def simple_entry(
    db: Session,
    *,
    entry_date: date,
    entry_type: EntryType,
    currency_id: int,
    debit_account_id: int,
    credit_account_id: int,
    amount: Decimal,
    description: str | None = None,
    client_id: int | None = None,
    contract_id: int | None = None,
    exchange_rate: Decimal | None = None,
    user: User | None = None,
) -> JournalEntry:
    """The two-line Dr/Cr entry that receipts, payments and sales all reduce to."""
    return create_entry(
        db,
        JournalEntryCreate(
            entry_date=entry_date,
            entry_type=entry_type,
            description=description,
            contract_id=contract_id,
            currency_id=currency_id,
            exchange_rate=exchange_rate,
            is_posted=True,
            lines=[
                JournalLineIn(
                    account_id=debit_account_id, client_id=client_id, debit=amount, line_desc=description
                ),
                JournalLineIn(
                    account_id=credit_account_id, client_id=client_id, credit=amount, line_desc=description
                ),
            ],
        ),
        user,
    )


def post_entry(db: Session, entry: JournalEntry) -> JournalEntry:
    """Mark an entry posted after re-checking it balances in base currency."""
    if entry.is_posted:
        return entry

    debit = sum((line.debit_base for line in entry.lines), Decimal(0))
    credit = sum((line.credit_base for line in entry.lines), Decimal(0))
    if debit != credit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Entry {entry.entry_no} is not balanced: debit={debit} credit={credit}",
        )
    if not entry.lines:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Entry {entry.entry_no} has no lines"
        )

    entry.is_posted = True
    db.flush()
    return entry
