from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import Account, Client, EntryType, Payment, Receipt, User
from app.schemas.cash import PaymentCreate, ReceiptCreate
from app.services import accounts as accounts_service
from app.services import contracts as contracts_service
from app.services import ledger as ledger_service
from app.services.numbering import next_number

RECEIPT_PREFIX = "REC-"
PAYMENT_PREFIX = "PAY-"


def cash_account(db: Session, account_id: int) -> Account:
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown cash account {account_id}"
        )
    if not account.is_cash_bank:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account {account.code} is not flagged as a cash/bank account",
        )
    return accounts_service.ensure_postable(account)


def create_receipt(db: Session, data: ReceiptCreate, user: User | None = None) -> Receipt:
    """Record money in: Dr cash/bank, Cr the client's receivable.

    The GL entry, the receipt row and the schedule allocation all happen in the
    caller's transaction, so a failure anywhere leaves nothing half-applied.
    """
    client = db.get(Client, data.client_id)
    if client is None or client.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    if client.account_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Client has no receivable account — cannot post a receipt",
        )

    cash = cash_account(db, data.cash_account_id)

    receipt = Receipt(
        receipt_no=data.receipt_no or next_number(db, Receipt.receipt_no, RECEIPT_PREFIX),
        ref_no=data.ref_no,
        receipt_date=data.receipt_date,
        client_id=client.id,
        contract_id=data.contract_id,
        cash_account_id=cash.id,
        amount=data.amount,
        currency_id=data.currency_id,
        method=data.method,
        cheque_no=data.cheque_no,
        notes=data.notes,
        created_by=user.id if user else None,
    )

    if data.post:
        entry = ledger_service.simple_entry(
            db,
            entry_date=data.receipt_date,
            entry_type=EntryType.receipt,
            currency_id=data.currency_id,
            debit_account_id=cash.id,
            credit_account_id=client.account_id,
            amount=Decimal(data.amount),
            description=data.notes or f"قبض من {client.name_ar}",
            client_id=client.id,
            contract_id=data.contract_id,
            exchange_rate=data.exchange_rate,
            user=user,
        )
        receipt.journal_entry_id = entry.id
        receipt.exchange_rate = entry.exchange_rate
    else:
        receipt.exchange_rate = data.exchange_rate or Decimal(1)

    db.add(receipt)
    db.flush()

    if data.contract_id is not None:
        contracts_service.allocate_payment(db, data.contract_id, Decimal(data.amount))

    return receipt


def create_payment(db: Session, data: PaymentCreate, user: User | None = None) -> Payment:
    """Record money out: Dr the beneficiary/expense account, Cr cash/bank."""
    beneficiary = db.get(Account, data.beneficiary_account_id)
    if beneficiary is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown beneficiary account"
        )
    accounts_service.ensure_postable(beneficiary)
    cash = cash_account(db, data.cash_account_id)

    if beneficiary.id == cash.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Beneficiary and cash account must differ",
        )

    payment = Payment(
        payment_no=data.payment_no or next_number(db, Payment.payment_no, PAYMENT_PREFIX),
        ref_no=data.ref_no,
        payment_date=data.payment_date,
        beneficiary_account_id=beneficiary.id,
        contract_id=data.contract_id,
        cash_account_id=cash.id,
        amount=data.amount,
        currency_id=data.currency_id,
        method=data.method,
        cheque_no=data.cheque_no,
        notes=data.notes,
        created_by=user.id if user else None,
    )

    if data.post:
        entry = ledger_service.simple_entry(
            db,
            entry_date=data.payment_date,
            entry_type=EntryType.payment,
            currency_id=data.currency_id,
            debit_account_id=beneficiary.id,
            credit_account_id=cash.id,
            amount=Decimal(data.amount),
            description=data.notes or f"صرف إلى {beneficiary.name_ar}",
            contract_id=data.contract_id,
            exchange_rate=data.exchange_rate,
            user=user,
        )
        payment.journal_entry_id = entry.id
        payment.exchange_rate = entry.exchange_rate
    else:
        payment.exchange_rate = data.exchange_rate or Decimal(1)

    db.add(payment)
    db.flush()
    return payment
