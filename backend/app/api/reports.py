from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select

from app.core.deps import DbSession, get_current_user, require_perm
from app.services import collection as collection_service
from app.models import (
    Account,
    Apartment,
    ApartmentStatus,
    Building,
    Client,
    Contract,
    ContractStatus,
    Currency,
    EntryType,
    JournalEntry,
    JournalLine,
    PaymentSchedule,
    Receipt,
    ScheduleStatus,
)
from app.schemas.contracts import OverdueRow
from app.schemas.reports import (
    AccountLedger,
    AvailabilityRow,
    CashBalance,
    ClientBalanceRow,
    ClientBalancesReport,
    CollectionMonth,
    CollectionReport,
    Dashboard,
    DebtorRow,
    KpiCard,
    RecentReceipt,
    LedgerRow,
    MonthlyReport,
    MonthRow,
    RecentDoc,
    SalesReport,
    SalesRow,
)

router = APIRouter(prefix="/api/reports", tags=["reports"], dependencies=[Depends(get_current_user)])


def _month_start(day: date) -> date:
    return day.replace(day=1)


@router.get("/dashboard", response_model=Dashboard, dependencies=[Depends(require_perm("dashboard.view"))])
def dashboard(db: DbSession, as_of: date | None = None) -> Dashboard:
    """لوحة التحكم — headline numbers, latest documents, what is coming due."""
    today = as_of or date.today()

    unit_counts = dict(
        db.execute(
            select(Apartment.status, func.count())
            .where(~Apartment.is_deleted)
            .group_by(Apartment.status)
        ).all()
    )

    receivable = db.scalar(
        select(
            func.coalesce(func.sum(JournalLine.debit_base - JournalLine.credit_base), 0)
        )
        .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
        .join(Account, Account.id == JournalLine.account_id)
        .where(Account.is_client, ~JournalEntry.is_deleted)
    ) or Decimal(0)

    collected = db.scalar(
        select(func.coalesce(func.sum(Receipt.amount * Receipt.exchange_rate), 0)).where(
            ~Receipt.is_deleted,
            Receipt.receipt_date >= _month_start(today),
            Receipt.receipt_date <= today,
        )
    ) or Decimal(0)

    overdue_total = db.scalar(
        select(func.coalesce(func.sum(PaymentSchedule.amount - PaymentSchedule.paid_amount), 0))
        .join(Contract, Contract.id == PaymentSchedule.contract_id)
        .where(
            ~Contract.is_deleted,
            PaymentSchedule.due_date < today,
            PaymentSchedule.status.in_(
                [ScheduleStatus.pending, ScheduleStatus.partial, ScheduleStatus.overdue]
            ),
            PaymentSchedule.amount > PaymentSchedule.paid_amount,
        )
    ) or Decimal(0)

    kpis = KpiCard(
        total_buildings=db.scalar(
            select(func.count()).select_from(Building).where(~Building.is_deleted)
        ) or 0,
        total_units=sum(unit_counts.values()),
        units_sold=unit_counts.get(ApartmentStatus.sold, 0),
        units_rented=unit_counts.get(ApartmentStatus.rented, 0),
        units_available=unit_counts.get(ApartmentStatus.available, 0),
        total_clients=db.scalar(select(func.count()).select_from(Client).where(~Client.is_deleted)) or 0,
        active_contracts=db.scalar(
            select(func.count()).select_from(Contract).where(
                ~Contract.is_deleted, Contract.status == ContractStatus.active
            )
        ) or 0,
        receivable_base=receivable,
        collected_this_month=collected,
        overdue_base=overdue_total,
    )

    # Latest documents, with each entry's size = the sum of its debits in base.
    totals = (
        select(JournalLine.entry_id, func.sum(JournalLine.debit_base).label("amount"))
        .group_by(JournalLine.entry_id)
        .subquery()
    )
    recent = [
        RecentDoc(
            entry_date=entry_date,
            entry_no=entry_no,
            entry_type=entry_type,
            description=description,
            amount_base=amount or Decimal(0),
        )
        for entry_date, entry_no, entry_type, description, amount in db.execute(
            select(
                JournalEntry.entry_date,
                JournalEntry.entry_no,
                JournalEntry.entry_type,
                JournalEntry.description,
                totals.c.amount,
            )
            .join(totals, totals.c.entry_id == JournalEntry.id, isouter=True)
            .where(~JournalEntry.is_deleted)
            .order_by(JournalEntry.entry_date.desc(), JournalEntry.id.desc())
            .limit(10)
        ).all()
    ]

    upcoming = [
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
            days_late=(today - due_date).days,
        )
        for row_id, contract_no, contract_type, client_id, client_name, due_date, amount, paid in db.execute(
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
                PaymentSchedule.amount > PaymentSchedule.paid_amount,
            )
            .order_by(PaymentSchedule.due_date)
            .limit(10)
        ).all()
    ]

    # Balances per account over live entries only - the trial-balance shape.
    live_balance = (
        select(
            JournalLine.account_id.label("account_id"),
            func.sum(JournalLine.debit_base - JournalLine.credit_base).label("balance"),
        )
        .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
        .where(~JournalEntry.is_deleted)
        .group_by(JournalLine.account_id)
        .subquery()
    )

    cash_accounts = [
        CashBalance(account_id=account_id, code=code, name=name, balance=balance or Decimal(0))
        for account_id, code, name, balance in db.execute(
            select(Account.id, Account.code, Account.name_ar, live_balance.c.balance)
            .outerjoin(live_balance, live_balance.c.account_id == Account.id)
            .where(Account.is_cash_bank, Account.is_postable)
            .order_by(Account.code)
        ).all()
    ]

    client_balance = (
        select(Client, live_balance.c.balance)
        .join(live_balance, live_balance.c.account_id == Client.account_id)
        .where(~Client.is_deleted)
    )
    top_debtors = [
        DebtorRow(
            client_id=client.id,
            code=client.code,
            name=client.name_ar,
            project=client.project,
            balance=balance,
        )
        for client, balance in db.execute(
            client_balance.where(live_balance.c.balance > 0)
            .order_by(live_balance.c.balance.desc())
            .limit(8)
        ).all()
    ]
    debtors_count = db.scalar(
        select(func.count()).select_from(client_balance.where(live_balance.c.balance > 0).subquery())
    ) or 0
    creditors_count = db.scalar(
        select(func.count()).select_from(client_balance.where(live_balance.c.balance < 0).subquery())
    ) or 0

    recent_receipts = [
        RecentReceipt(
            id=receipt_id,
            receipt_no=receipt_no,
            ref_no=ref_no,
            receipt_date=receipt_date,
            client_id=client_id,
            client_name=client_name,
            amount_base=(Decimal(amount) * Decimal(rate)).quantize(Decimal("0.01")),
        )
        for receipt_id, receipt_no, ref_no, receipt_date, client_id, client_name, amount, rate in db.execute(
            select(
                Receipt.id,
                Receipt.receipt_no,
                Receipt.ref_no,
                Receipt.receipt_date,
                Receipt.client_id,
                Client.name_ar,
                Receipt.amount,
                Receipt.exchange_rate,
            )
            .outerjoin(Client, Client.id == Receipt.client_id)
            .where(~Receipt.is_deleted)
            .order_by(Receipt.receipt_date.desc(), Receipt.id.desc())
            .limit(8)
        ).all()
    ]

    return Dashboard(
        kpis=kpis,
        recent_docs=recent,
        upcoming_dues=upcoming,
        cash_accounts=cash_accounts,
        top_debtors=top_debtors,
        recent_receipts=recent_receipts,
        debtors_count=debtors_count,
        creditors_count=creditors_count,
    )


@router.get("/account-ledger/{account_id}", response_model=AccountLedger, dependencies=[Depends(require_perm("reports.view", "accounts.view"))])
def account_ledger(
    db: DbSession,
    account_id: int,
    date_from: date | None = None,
    date_to: date | None = None,
) -> AccountLedger:
    """دفتر الأستاذ for one account, with the pre-period balance folded in."""
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    stmt = (
        select(
            JournalEntry.entry_date,
            JournalEntry.entry_no,
            JournalEntry.entry_type,
            JournalLine.line_desc,
            JournalLine.debit_base,
            JournalLine.credit_base,
        )
        .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
        .where(JournalLine.account_id == account_id, ~JournalEntry.is_deleted)
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
                JournalLine.account_id == account_id,
                ~JournalEntry.is_deleted,
                JournalEntry.entry_date < date_from,
            )
        ).one()
        opening = Decimal(prior_debit) - Decimal(prior_credit)
        stmt = stmt.where(JournalEntry.entry_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(JournalEntry.entry_date <= date_to)

    running = opening
    rows: list[LedgerRow] = []
    for entry_date, entry_no, entry_type, desc, debit, credit in db.execute(stmt).all():
        running += Decimal(debit) - Decimal(credit)
        rows.append(
            LedgerRow(
                entry_date=entry_date,
                entry_no=entry_no,
                entry_type=EntryType(entry_type),
                line_desc=desc,
                debit_base=debit,
                credit_base=credit,
                running_balance_base=running,
            )
        )

    return AccountLedger(
        account_id=account.id,
        account_code=account.code,
        account_name=account.name_ar,
        date_from=date_from,
        date_to=date_to,
        opening_balance=opening,
        rows=rows,
        closing_balance=running,
    )


@router.get("/availability", response_model=list[AvailabilityRow], dependencies=[Depends(require_perm("reports.view", "units.view"))])
def availability(db: DbSession, building_id: int | None = None) -> list[AvailabilityRow]:
    """Apartment availability board."""
    stmt = (
        select(
            Building.name,
            Apartment.unit_no,
            Apartment.floor,
            Apartment.unit_type,
            Apartment.status,
            Apartment.listed_price,
            Currency.code,
        )
        .join(Building, (Building.id == Apartment.building_id) & (~Building.is_deleted))
        .join(Currency, Currency.id == Apartment.price_currency_id, isouter=True)
        .where(~Apartment.is_deleted)
        .order_by(Building.name, Apartment.floor, Apartment.unit_no)
    )
    if building_id is not None:
        stmt = stmt.where(Apartment.building_id == building_id)

    return [
        AvailabilityRow(
            building=building,
            unit_no=unit_no,
            floor=floor,
            unit_type=unit_type.value,
            status=unit_status.value,
            listed_price=price,
            price_currency=currency,
        )
        for building, unit_no, floor, unit_type, unit_status, price, currency in db.execute(stmt).all()
    ]


@router.get("/sales", response_model=SalesReport, dependencies=[Depends(require_perm("reports.view"))])
def sales_report(
    db: DbSession,
    date_from: date | None = None,
    date_to: date | None = None,
    client_id: int | None = None,
) -> SalesReport:
    """تقرير المبيعات — one row per sale document.

    The amount is taken from the debit side of the client's own receivable
    account rather than from the revenue credit: that is the figure the client
    was actually charged, and it survives an entry that splits revenue across
    more than one account (VAT, discounts) without double counting.
    """
    amount = func.coalesce(func.sum(JournalLine.debit_base), 0)

    stmt = (
        select(
            JournalEntry.id,
            JournalEntry.entry_date,
            JournalEntry.entry_no,
            JournalEntry.description,
            Client.id,
            Client.name_ar,
            amount,
        )
        .join(JournalLine, JournalLine.entry_id == JournalEntry.id)
        .join(Account, Account.id == JournalLine.account_id)
        .join(Client, Client.account_id == Account.id, isouter=True)
        .where(
            JournalEntry.entry_type == EntryType.sale,
            ~JournalEntry.is_deleted,
            Account.is_client,
        )
        .group_by(
            JournalEntry.id,
            JournalEntry.entry_date,
            JournalEntry.entry_no,
            JournalEntry.description,
            Client.id,
            Client.name_ar,
        )
        .order_by(JournalEntry.entry_date.desc(), JournalEntry.id.desc())
    )
    if date_from is not None:
        stmt = stmt.where(JournalEntry.entry_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(JournalEntry.entry_date <= date_to)
    if client_id is not None:
        stmt = stmt.where(Client.id == client_id)

    rows = [
        SalesRow(
            entry_id=entry_id,
            entry_date=entry_date,
            entry_no=entry_no,
            client_id=cid,
            client_name=cname,
            description=description,
            amount_base=total,
        )
        for entry_id, entry_date, entry_no, description, cid, cname, total in db.execute(stmt).all()
    ]
    return SalesReport(
        date_from=date_from,
        date_to=date_to,
        rows=rows,
        total_base=sum((r.amount_base for r in rows), Decimal(0)),
    )


@router.get("/monthly", response_model=MonthlyReport, dependencies=[Depends(require_perm("reports.view", "dashboard.view"))])
def monthly_report(
    db: DbSession,
    date_from: date | None = None,
    date_to: date | None = None,
) -> MonthlyReport:
    """الملخص الشهري — sales raised, cash in and cash out, month by month.

    Cash in and out are read off the cash/bank accounts themselves, so a
    receipt and a payment that never touched the till (a contra entry, say)
    do not inflate the month.
    """
    month = func.to_char(JournalEntry.entry_date, "YYYY-MM")

    def totals(*conditions):  # noqa: ANN002, ANN202 - local shorthand
        stmt = (
            select(
                month,
                func.coalesce(func.sum(JournalLine.debit_base), 0),
                func.coalesce(func.sum(JournalLine.credit_base), 0),
            )
            .join(JournalLine, JournalLine.entry_id == JournalEntry.id)
            .join(Account, Account.id == JournalLine.account_id)
            .where(~JournalEntry.is_deleted, *conditions)
            .group_by(month)
        )
        if date_from is not None:
            stmt = stmt.where(JournalEntry.entry_date >= date_from)
        if date_to is not None:
            stmt = stmt.where(JournalEntry.entry_date <= date_to)
        return {m: (Decimal(d), Decimal(c)) for m, d, c in db.execute(stmt).all()}

    cash = totals(Account.is_cash_bank)
    sales = totals(JournalEntry.entry_type == EntryType.sale, Account.is_client)

    rows: list[MonthRow] = []
    for key in sorted(set(cash) | set(sales), reverse=True):
        received, paid = cash.get(key, (Decimal(0), Decimal(0)))
        sold = sales.get(key, (Decimal(0), Decimal(0)))[0]
        rows.append(
            MonthRow(
                month=key,
                sales_base=sold,
                received_base=received,
                paid_base=paid,
                net_base=received - paid,
            )
        )

    return MonthlyReport(
        date_from=date_from,
        date_to=date_to,
        rows=rows,
        sales_base=sum((r.sales_base for r in rows), Decimal(0)),
        received_base=sum((r.received_base for r in rows), Decimal(0)),
        paid_base=sum((r.paid_base for r in rows), Decimal(0)),
        net_base=sum((r.net_base for r in rows), Decimal(0)),
    )


@router.get(
    "/collection",
    response_model=CollectionReport,
    dependencies=[Depends(require_perm("dashboard.view", "reports.view"))],
)
def collection_report(
    db: DbSession, months: int = Query(default=6, ge=1, le=36), as_of: date | None = None
) -> CollectionReport:
    """Of the clients who owed at the start of each month, how many paid —
    the dashboard ring (current) and its trend (months). Same rule as the
    reminders: app/services/collection.py."""
    as_of = as_of or date.today()
    rows = [CollectionMonth(**m.__dict__) for m in collection_service.collection(db, as_of, months)]
    return CollectionReport(as_of=as_of, current=rows[-1], months=rows)


@router.get("/client-balances", response_model=ClientBalancesReport, dependencies=[Depends(require_perm("reports.view", "clients.view"))])
def client_balances(
    db: DbSession,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    side: str | None = None,
) -> ClientBalancesReport:
    """كشف الأرصدة حسب عملة الحساب — every client's debit, credit and balance
    for the period, with where they bought, in the legacy report's order (code).

    Which lines count is settled inside a subquery with an inner join on live
    entries, then joined back outer - the trial-balance shape, so a voided
    document leaves the totals and a client who never moved still lists."""
    live = (
        select(
            JournalLine.account_id.label("account_id"),
            func.sum(JournalLine.debit_base).label("debit"),
            func.sum(JournalLine.credit_base).label("credit"),
        )
        .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
        .where(~JournalEntry.is_deleted)
    )
    if date_from:
        live = live.where(JournalEntry.entry_date >= date_from)
    if date_to:
        live = live.where(JournalEntry.entry_date <= date_to)
    live = live.group_by(JournalLine.account_id).subquery()

    stmt = (
        select(Client, Currency.name_ar, live.c.debit, live.c.credit)
        .outerjoin(Account, Account.id == Client.account_id)
        .outerjoin(Currency, Currency.id == Account.currency_id)
        .outerjoin(live, live.c.account_id == Client.account_id)
        .where(~Client.is_deleted)
        .order_by(Client.code, Client.name_ar)
    )
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Client.name_ar.ilike(like)
            | Client.code.ilike(like)
            | Client.phone.ilike(like)
            | Client.project.ilike(like)
            | Client.block.ilike(like)
        )

    # An account with no currency of its own is kept in the base currency -
    # which is also what every amount here is (the _base columns).
    base_name = db.scalar(select(Currency.name_ar).where(Currency.is_base))

    rows: list[ClientBalanceRow] = []
    for client, currency, debit, credit in db.execute(stmt).all():
        currency = currency or base_name
        debit = debit or Decimal(0)
        credit = credit or Decimal(0)
        balance = debit - credit
        if side == "debit" and balance <= 0:
            continue
        if side == "credit" and balance >= 0:
            continue
        if side == "nonzero" and balance == 0:
            continue
        rows.append(
            ClientBalanceRow(
                client_id=client.id,
                code=client.code,
                name=client.name_ar,
                currency=currency,
                debit=debit,
                credit=credit,
                balance=balance,
                phone=client.phone,
                project=client.project,
                block=client.block,
                floor_side=client.floor_side,
            )
        )

    return ClientBalancesReport(
        date_from=date_from,
        date_to=date_to,
        rows=rows,
        total_debit=sum((r.debit for r in rows), Decimal(0)),
        total_credit=sum((r.credit for r in rows), Decimal(0)),
        total_balance=sum((r.balance for r in rows), Decimal(0)),
    )
