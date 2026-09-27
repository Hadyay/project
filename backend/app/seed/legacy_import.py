"""Import the FoxPro-era dataset (47 CSVs in `legacy_data/`) into the ERP.

    python -m app.seed.legacy_import                 # dry run: parse, validate, reconcile
    python -m app.seed.legacy_import --commit        # actually write
    python -m app.seed.legacy_import --dir ../legacy_data

What comes across, and from where:

    ACCOUNTMAP  -> accounts        the Lebanese chart, codes kept verbatim
    ACCOUNTMAP  -> clients         every 411xxxxx leaf is one customer
    JOURNAL     -> journal_entries document headers (two lines each, typically)
    SACCOUNT    -> journal_lines   debit/credit in txn currency + USD base
    RECEIPT     -> receipts        قبض, all cash, all against a client
    PAYMENT     -> payments        صرف, in this dataset only refunds to clients

Buildings, units and contracts are NOT imported: the legacy system has no
contract table, and apartments live as free-text `CATEGORY1` codes ("432/C")
on SITEMS/ALLITEMS. That is a separate import with its own judgement calls.

The dry run touches no database at all — it parses, validates and reconciles
the planned trial balance against the legacy MIZAN.csv, which is the check
that actually matters. Only `--commit` opens a session, and it writes
everything in one transaction. Re-running is safe: rows already carrying a
legacy key are skipped, not duplicated.
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path

from sqlalchemy.orm import Session

from app.models import AccountType, EntryType, PaymentMethod
from app.seed import legacy_map

# --------------------------------------------------------------------- input

NULL = "<null>"
CENTS = Decimal("0.01")
ZERO = Decimal("0.00")

MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}

# Prefixes for the keys this import mints, so a re-run can recognise its own
# rows and an accountant can tell an imported document from one raised in the
# new app.
ENTRY_PREFIX = "LEG-"
RECEIPT_PREFIX = "LEG-R-"
PAYMENT_PREFIX = "LEG-P-"


class Table:
    """A legacy CSV.

    Several of these files are fixed-width dumps that were comma-split after
    the fact, so their headers turn to mush partway across — ACCOUNTMAP and
    PAYMENT both do. Only the leading columns are trustworthy, and those are
    the only ones this import reads. `require` asserts they are where they
    should be rather than letting a silent shift corrupt the ledger.
    """

    def __init__(self, path: Path, require: tuple[str, ...]):
        with path.open(encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.reader(fh))
        if not rows:
            raise SystemExit(f"{path.name} is empty")
        header = [c.strip() for c in rows[0]]
        for i, name in enumerate(require):
            if i >= len(header) or header[i] != name:
                found = header[i] if i < len(header) else "<past end of header>"
                raise SystemExit(
                    f"{path.name}: expected column {i} to be {name!r}, found {found!r} — "
                    "the file layout changed, re-check the mapping before importing"
                )
        self.name = path.stem
        self.index = {name: i for i, name in enumerate(require)}
        self.rows = rows[1:]

    def __len__(self) -> int:
        return len(self.rows)

    def __iter__(self):
        for row in self.rows:
            yield Row(self, row)


class Row:
    def __init__(self, table: Table, values: list[str]):
        self._table = table
        self._values = values

    def raw(self, column: str) -> str:
        i = self._table.index[column]
        return self._values[i] if i < len(self._values) else ""

    def text(self, column: str) -> str | None:
        value = self.raw(column).strip()
        return None if value in ("", NULL) else value

    def dec(self, column: str) -> Decimal:
        value = self.text(column)
        return Decimal(value) if value else Decimal(0)

    def money(self, column: str) -> Decimal:
        return self.dec(column).quantize(CENTS)

    def date(self, column: str) -> date:
        value = self.text(column)
        if not value:
            raise ValueError(f"{self._table.name}: empty date in {column}")
        day, month, year = value.split("-")
        return date(int(year), MONTHS[month.upper()], int(day))

    def flag(self, column: str) -> bool:
        return self.raw(column).strip().lower() == "true"


# ------------------------------------------------------------------ the plan


@dataclass
class PlannedAccount:
    code: str
    name_ar: str
    parent_code: str | None
    account_type: AccountType
    is_client: bool
    is_cash_bank: bool
    is_postable: bool
    synthesized: bool = False


@dataclass
class PlannedClient:
    code: str
    name_ar: str
    account_code: str


@dataclass
class PlannedLine:
    account_code: str
    client_code: str | None
    debit: Decimal
    credit: Decimal
    debit_base: Decimal
    credit_base: Decimal
    line_desc: str | None


@dataclass
class PlannedEntry:
    entry_no: str
    entry_date: date
    entry_type: EntryType
    description: str | None
    currency_code: str
    exchange_rate: Decimal
    lines: list[PlannedLine] = field(default_factory=list)


@dataclass
class PlannedReceipt:
    receipt_no: str
    receipt_date: date
    client_code: str
    cash_account_code: str
    amount: Decimal
    currency_code: str
    exchange_rate: Decimal
    method: PaymentMethod
    cheque_no: str | None
    entry_no: str | None
    notes: str | None


@dataclass
class PlannedPayment:
    payment_no: str
    payment_date: date
    beneficiary_account_code: str
    cash_account_code: str
    amount: Decimal
    currency_code: str
    exchange_rate: Decimal
    method: PaymentMethod
    cheque_no: str | None
    entry_no: str | None
    notes: str | None


@dataclass
class PlannedCurrency:
    code: str
    name_ar: str
    name_en: str
    symbol: str | None


@dataclass
class Plan:
    accounts: dict[str, PlannedAccount] = field(default_factory=dict)
    clients: list[PlannedClient] = field(default_factory=list)
    currencies: list[PlannedCurrency] = field(default_factory=list)
    entries: list[PlannedEntry] = field(default_factory=list)
    receipts: list[PlannedReceipt] = field(default_factory=list)
    payments: list[PlannedPayment] = field(default_factory=list)
    rates: list[tuple[str, date, Decimal]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def note(self, message: str) -> None:
        self.notes.append(message)

    def error(self, message: str) -> None:
        self.errors.append(message)


# ------------------------------------------------------------------- reading

# Column names this import relies on, in position order. RECEIPT and PAYMENT
# share a layout for the first nineteen columns; PAYMENT's header is mangled
# after that, RECEIPT's survives a little longer. Both are read through the
# common prefix only.
FILES: dict[str, tuple[str, ...]] = {
    "ACCOUNTMAP": ("SID", "SNAME", "MID", "SMAIN"),
    "SCURRENCY": ("CURRID", "CURRNAME", "CURRVAL", "FDATE"),
    "JOURNAL": ("JID", "AUTONO", "MYFNO", "FDATE", "DESCR", "FTYPE", "FNO"),
    "SACCOUNT": (
        "FNO", "MYFNO", "AUTONO", "JID", "SNAME", "FDATE", "FIDATE", "DESCR", "DESCR1",
        "FTYPE", "DTYPE", "CURRID", "CURRNAME", "CURRVAL",
        "DEBIT", "DEBITUS", "DEBITLL", "CREDIT", "CREDITUS", "CREDITLL",
        "ACCOUNTNUMBER", "INVFNO", "SCLOSE", "SID",
    ),
    "RECEIPT": (
        "FNO", "JID", "AUTONO", "MYFNO", "SACTIVE", "FTYPE", "CURRID", "CURRNAME", "CURRVAL",
        "FDATE", "DESCR", "SAMOUNT", "STOTAL", "STOTALLL", "STOTALUS",
        "SID", "SNAME", "SSID", "SSNAME",
    ),
    "PAYMENT": (
        "FNO", "JID", "AUTONO", "MYFNO", "SACTIVE", "FTYPE", "CURRID", "CURRNAME", "CURRVAL",
        "FDATE", "DESCR", "SAMOUNT", "STOTAL", "STOTALLL", "STOTALUS",
        "SID", "SNAME", "SSID", "SSNAME",
    ),
    "MIZAN": ("MID", "SID", "SNAME", "FDATE", "MYDEBITLL", "MYCREDITLL", "MYDEBITUS", "MYCREDITUS"),
}


def read_all(source: Path) -> dict[str, Table]:
    tables = {}
    for name, columns in FILES.items():
        path = source / f"{name}.csv"
        if not path.exists():
            raise SystemExit(f"missing {path}")
        tables[name] = Table(path, columns)
    return tables


# ------------------------------------------------------------------ building


def currency_code(row: Row) -> str:
    """ISO code for a legacy CURRNAME, e.g. 'دولار' -> 'USD'."""
    name = row.text("CURRNAME")
    code = legacy_map.CURRENCY_CODES.get(name or "")
    if code is None:
        raise ValueError(f"unknown legacy currency {name!r}")
    return code


def rate_to_base(row: Row) -> Decimal:
    """CURRVAL is units per USD; the schema stores the inverse."""
    value = row.dec("CURRVAL")
    if value <= 0:
        raise ValueError(f"non-positive CURRVAL {value}")
    return (Decimal(1) / value).quantize(Decimal("0.000001"))


def build_accounts(plan: Plan, accountmap: Table) -> None:
    present = {row.text("SID") for row in accountmap}
    for row in accountmap:
        code = row.text("SID")
        if not code:
            continue
        parent = row.text("MID")
        # The legacy roots are three digits and their MID points at a two-digit
        # class that has no row of its own. Those become top-level accounts
        # rather than being grafted onto the starter chart, whose one- and
        # two-digit codes mean something different — its 5 is revenue, the
        # Lebanese plan's 5 is cash and banks.
        plan.accounts[code] = PlannedAccount(
            code=code,
            name_ar=row.text("SNAME") or code,
            parent_code=parent if parent in present else None,
            account_type=legacy_map.account_type_for(code),
            is_client=legacy_map.is_client_code(code),
            is_cash_bank=legacy_map.is_cash_code(code),
            is_postable=not row.flag("SMAIN"),
        )


def ensure_account(plan: Plan, code: str, reason: str) -> None:
    """Mint an account the transactions use but ACCOUNTMAP never defined."""
    if not code or code in plan.accounts:
        return
    parent = next(
        (c for c in sorted(plan.accounts, key=len, reverse=True) if code.startswith(c) and c != code),
        None,
    )
    parent_name = plan.accounts[parent].name_ar if parent else None
    plan.accounts[code] = PlannedAccount(
        code=code,
        name_ar=parent_name or code,
        parent_code=parent,
        account_type=legacy_map.account_type_for(code),
        is_client=legacy_map.is_client_code(code),
        is_cash_bank=legacy_map.is_cash_code(code),
        is_postable=True,
        synthesized=True,
    )
    plan.note(
        f"account {code} is {reason} but missing from ACCOUNTMAP — created under "
        f"{parent or 'no parent'} borrowing the name {parent_name or code!r}; "
        "give it a proper name before go-live"
    )


def build_clients(plan: Plan, accountmap: Table) -> None:
    for row in accountmap:
        code = row.text("SID")
        if not code or not legacy_map.is_client_code(code):
            continue
        plan.clients.append(
            PlannedClient(code=code, name_ar=row.text("SNAME") or code, account_code=code)
        )


def balance_base(lines: list[PlannedLine]) -> None:
    """Absorb the rounding residual so the entry balances in base currency.

    Same policy as `services.ledger._base_amounts`: the largest line on the
    heavier side gives up the odd cent. The legacy amounts arrive as raw
    binary floats printed to sixteen places, so a handful of entries are off
    by ~1e-12 before rounding and by a cent after it.
    """
    residual = sum((line.debit_base for line in lines), ZERO) - sum(
        (line.credit_base for line in lines), ZERO
    )
    if residual == 0 or not lines:
        return
    if residual > 0:
        victim = max(lines, key=lambda line: line.debit_base)
        victim.debit_base -= residual
    else:
        victim = max(lines, key=lambda line: line.credit_base)
        victim.credit_base += residual


def build_journal(plan: Plan, journal: Table, saccount: Table) -> None:
    lines_by_jid: dict[str, list[Row]] = defaultdict(list)
    for row in saccount:
        lines_by_jid[row.text("JID") or ""].append(row)

    empty = 0
    for header in journal:
        jid = header.text("JID")
        rows = lines_by_jid.pop(jid or "", [])
        if not rows:
            empty += 1
            continue

        currencies = {currency_code(r) for r in rows}
        mixed = len(currencies) > 1
        if mixed:
            # journal_entries carries one currency and one rate, so an entry
            # whose lines were booked in different currencies is recorded in
            # base: the USD columns are authoritative either way, and the
            # original figure is kept on the line description.
            entry_currency, rate = "USD", Decimal(1)
        else:
            entry_currency, rate = next(iter(currencies)), rate_to_base(rows[0])

        lines: list[PlannedLine] = []
        for r in rows:
            account_code = r.text("SID")
            if not account_code:
                plan.error(f"JID {jid}: a line has no SID")
                continue
            ensure_account(plan, account_code, f"posted to by JID {jid}")
            debit, credit = r.money("DEBIT"), r.money("CREDIT")
            debit_base, credit_base = r.money("DEBITUS"), r.money("CREDITUS")
            if debit and credit:
                plan.error(f"JID {jid}: line on {account_code} is both debit and credit")
            desc = r.text("DESCR") or r.text("DESCR1")
            line_currency = currency_code(r)
            if mixed and line_currency != "USD":
                original = debit or credit
                debit, credit = debit_base, credit_base
                desc = f"{desc or ''} [{original:,} {line_currency} @ {r.dec('CURRVAL')}]".strip()
            lines.append(
                PlannedLine(
                    account_code=account_code,
                    client_code=account_code if legacy_map.is_client_code(account_code) else None,
                    debit=debit,
                    credit=credit,
                    debit_base=debit_base,
                    credit_base=credit_base,
                    line_desc=desc[:255] if desc else None,
                )
            )
        balance_base(lines)

        kind = header.text("DESCR") or ""
        plan.entries.append(
            PlannedEntry(
                entry_no=f"{ENTRY_PREFIX}{jid}",
                entry_date=header.date("FDATE"),
                entry_type=legacy_map.ENTRY_TYPES.get(kind, legacy_map.DEFAULT_ENTRY_TYPE),
                description=rows[0].text("DESCR") or kind or None,
                currency_code=entry_currency,
                exchange_rate=rate,
                lines=lines,
            )
        )
        if mixed:
            plan.note(
                f"JID {jid}: lines in {'+'.join(sorted(currencies))} — booked in USD at 1.0, "
                "each original amount kept on its line description"
            )

    if empty:
        plan.note(f"{empty} JOURNAL rows have no SACCOUNT lines (voided documents) — skipped")
    for jid, rows in lines_by_jid.items():
        plan.error(f"{len(rows)} SACCOUNT lines reference JID {jid}, which JOURNAL does not have")


# Every document in this dataset is نقدي; the column is read anyway so a later
# extract with cheques does not silently import as cash.
PAYMENT_METHODS: dict[str, PaymentMethod] = {
    "نقدي": PaymentMethod.cash,
    "شك": PaymentMethod.cheque,
    "شيك": PaymentMethod.cheque,
    "حوالة": PaymentMethod.bank_transfer,
}


def build_cash(plan: Plan, receipts: Table, payments: Table, entry_nos: set[str]) -> None:
    clients = {c.code for c in plan.clients}
    voided = 0

    for row in receipts:
        client = row.text("SID")
        cash = row.text("SSID")
        if client not in clients:
            # An abandoned document: no client, nothing collected, and the
            # journal entry behind it is two zero lines on the cash account.
            if not row.money("STOTAL"):
                voided += 1
                continue
            plan.error(
                f"receipt {row.text('FNO')}: SID {client} is not a client account, "
                f"but the receipt is for {row.money('STOTAL'):,}"
            )
            continue
        ensure_account(plan, cash or "", f"the counter-account of receipt {row.text('FNO')}")
        entry_no = f"{ENTRY_PREFIX}{row.text('JID')}"
        plan.receipts.append(
            PlannedReceipt(
                receipt_no=f"{RECEIPT_PREFIX}{row.text('FNO')}",
                receipt_date=row.date("FDATE"),
                client_code=client,
                cash_account_code=cash or "",
                amount=row.money("STOTAL"),
                currency_code=currency_code(row),
                exchange_rate=rate_to_base(row),
                method=PAYMENT_METHODS.get(row.text("FTYPE") or "", PaymentMethod.cash),
                cheque_no=None,
                entry_no=entry_no if entry_no in entry_nos else None,
                notes=row.text("DESCR"),
            )
        )

    for row in payments:
        beneficiary = row.text("SID")
        cash = row.text("SSID")
        ensure_account(plan, beneficiary or "", f"the beneficiary of payment {row.text('FNO')}")
        ensure_account(plan, cash or "", f"the counter-account of payment {row.text('FNO')}")
        entry_no = f"{ENTRY_PREFIX}{row.text('JID')}"
        plan.payments.append(
            PlannedPayment(
                payment_no=f"{PAYMENT_PREFIX}{row.text('FNO')}",
                payment_date=row.date("FDATE"),
                beneficiary_account_code=beneficiary or "",
                cash_account_code=cash or "",
                amount=row.money("STOTAL"),
                currency_code=currency_code(row),
                exchange_rate=rate_to_base(row),
                method=PAYMENT_METHODS.get(row.text("FTYPE") or "", PaymentMethod.cash),
                cheque_no=None,
                entry_no=entry_no if entry_no in entry_nos else None,
                notes=row.text("DESCR"),
            )
        )

    if voided:
        plan.note(f"{voided} zero-value receipts with no client (abandoned documents) — skipped")
    unlinked = [r for r in plan.receipts if r.entry_no is None]
    if unlinked:
        plan.note(f"{len(unlinked)} receipts have no matching journal entry — imported unlinked")


def build_currencies(plan: Plan, scurrency: Table) -> None:
    """Currencies and their one standing rate. SCURRENCY is a static table —
    the legacy system carried a single rate per currency, not a history."""
    for row in scurrency:
        code = currency_code(row)
        plan.currencies.append(
            PlannedCurrency(
                code=code,
                name_ar=row.text("CURRNAME") or code,
                name_en=legacy_map.CURRENCY_NAMES_EN.get(code, code),
                symbol=legacy_map.CURRENCY_SYMBOLS.get(code),
            )
        )
        if code == "USD":
            continue
        plan.rates.append((code, row.date("FDATE"), rate_to_base(row)))
    if any(code == "LBP" for code, _, _ in plan.rates):
        plan.note(
            "the LBP rate is stored as 1/1500 = 0.000667 (exchange_rates.rate_to_base is "
            "numeric(20,6)), so converting LBP forward loses ~0.05% — the imported ledger is "
            "unaffected, it carries the legacy USD figures directly"
        )


def build_plan(tables: dict[str, Table]) -> Plan:
    plan = Plan()
    build_accounts(plan, tables["ACCOUNTMAP"])
    build_clients(plan, tables["ACCOUNTMAP"])
    build_currencies(plan, tables["SCURRENCY"])
    build_journal(plan, tables["JOURNAL"], tables["SACCOUNT"])
    build_cash(plan, tables["RECEIPT"], tables["PAYMENT"], {e.entry_no for e in plan.entries})
    return plan


# ------------------------------------------------------------ reconciliation


def totals_by_account(plan: Plan) -> dict[str, tuple[Decimal, Decimal]]:
    totals: dict[str, list[Decimal]] = defaultdict(lambda: [ZERO, ZERO])
    for entry in plan.entries:
        for line in entry.lines:
            totals[line.account_code][0] += line.debit_base
            totals[line.account_code][1] += line.credit_base
    return {code: (debit, credit) for code, (debit, credit) in totals.items()}


def totals_from_mizan(mizan: Table) -> dict[str, tuple[Decimal, Decimal]]:
    totals: dict[str, list[Decimal]] = defaultdict(lambda: [ZERO, ZERO])
    for row in mizan:
        code = row.text("SID") or ""
        totals[code][0] += row.dec("MYDEBITUS")
        totals[code][1] += row.dec("MYCREDITUS")
    return {
        code: (debit.quantize(CENTS), credit.quantize(CENTS))
        for code, (debit, credit) in totals.items()
    }


def reconcile(plan: Plan, mizan: Table) -> list[str]:
    """Compare the planned trial balance with the legacy one. Empty == clean."""
    ours, theirs = totals_by_account(plan), totals_from_mizan(mizan)
    problems = []
    for code in sorted(ours.keys() | theirs.keys()):
        mine = ours.get(code, (ZERO, ZERO))
        legacy = theirs.get(code, (ZERO, ZERO))
        if mine == legacy:
            continue
        if code in legacy_map.KNOWN_MIZAN_GAPS:
            plan.note(
                f"account {code} differs from MIZAN as expected: imported "
                f"{mine[0]:,}/{mine[1]:,} against MIZAN {legacy[0]:,}/{legacy[1]:,}"
            )
            continue
        problems.append(
            f"{code}: imported debit {mine[0]:,} credit {mine[1]:,} — "
            f"MIZAN debit {legacy[0]:,} credit {legacy[1]:,}"
        )
    debit = sum((d for d, _ in ours.values()), ZERO)
    credit = sum((c for _, c in ours.values()), ZERO)
    if debit != credit:
        problems.append(f"imported trial balance does not balance: {debit:,} against {credit:,}")
    return problems


# ---------------------------------------------------------------- the report


def report(plan: Plan, problems: list[str], source: Path) -> None:
    ours = totals_by_account(plan)
    debit = sum((d for d, _ in ours.values()), ZERO)
    credit = sum((c for _, c in ours.values()), ZERO)
    synthesized = [a for a in plan.accounts.values() if a.synthesized]

    print(f"legacy import — source {source}")
    print()
    print(f"  accounts   {len(plan.accounts):>6}  ({len(synthesized)} synthesized)")
    print(f"  clients    {len(plan.clients):>6}")
    print(f"  entries    {len(plan.entries):>6}  ({sum(len(e.lines) for e in plan.entries)} lines)")
    print(f"  receipts   {len(plan.receipts):>6}")
    print(f"  payments   {len(plan.payments):>6}")
    print(f"  currencies {len(plan.currencies):>6}  ({len(plan.rates)} rates)")
    print()
    kinds: dict[str, int] = defaultdict(int)
    for entry in plan.entries:
        kinds[entry.entry_type.value] += 1
    print("  by type:   " + ", ".join(f"{k} {v}" for k, v in sorted(kinds.items(), key=lambda i: -i[1])))
    dates = [e.entry_date for e in plan.entries]
    if dates:
        print(f"  dates:     {min(dates)} .. {max(dates)}")
    print()

    if plan.notes:
        print("notes")
        for note in plan.notes:
            print(f"  - {note}")
        print()

    print("reconciliation against MIZAN.csv (base USD)")
    print(f"  accounts with movement: {len(ours)}")
    print(f"  trial balance: debit {debit:,} / credit {credit:,}")
    if problems:
        print(f"  MISMATCHES ({len(problems)}):")
        for problem in problems:
            print(f"    ! {problem}")
    else:
        print("  no unexplained differences")
    print()

    if plan.errors:
        print("errors")
        for err in plan.errors:
            print(f"  ! {err}")
        print()


# --------------------------------------------------------------------- write


def write(plan: Plan, db: Session) -> dict[str, int]:
    """Insert the plan through `db`, skipping rows a previous run already made.

    Does not commit — the caller owns the transaction, so a half-written
    ledger is never left behind.
    """
    from sqlalchemy import select

    from app.models import (
        Account,
        Client,
        Currency,
        ExchangeRate,
        JournalEntry,
        JournalLine,
        Payment,
        Receipt,
        User,
    )

    currencies = {c.code: c.id for c in db.scalars(select(Currency)).all()}
    if not currencies:
        raise SystemExit("no currencies in the database — run `python -m app.seed.run` first")
    added_currencies = 0
    for planned_currency in plan.currencies:
        if planned_currency.code in currencies:
            continue
        currency = Currency(
            code=planned_currency.code,
            name_ar=planned_currency.name_ar,
            name_en=planned_currency.name_en,
            symbol=planned_currency.symbol,
            is_base=False,
        )
        db.add(currency)
        db.flush()
        currencies[currency.code] = currency.id
        added_currencies += 1

    admin = db.scalars(select(User).where(User.username == "admin")).one_or_none()
    actor = admin.id if admin else None

    accounts = {a.code: a for a in db.scalars(select(Account)).all()}

    # A code that already exists is only the same account if it hangs in the
    # same place. `POST /api/clients` mints its receivable sub-accounts as
    # 4110 + sequence, which produces 41100001, 41100002 … — exactly the codes
    # the legacy customers carry under 411. Importing on top of those would
    # merge two different people's ledgers into one account, silently.
    by_id = {a.id: a for a in accounts.values()}
    clashes = []
    for planned in plan.accounts.values():
        existing = accounts.get(planned.code)
        if existing is None:
            continue
        parent = by_id.get(existing.parent_id) if existing.parent_id else None
        parent_code = parent.code if parent else None
        if parent_code != planned.parent_code:
            clashes.append(
                f"    {planned.code}: database has {existing.name_ar!r} under "
                f"{parent_code or 'no parent'}, legacy has {planned.name_ar!r} under "
                f"{planned.parent_code or 'no parent'}"
            )
    if clashes:
        raise SystemExit(
            "refusing to import: these account codes already exist somewhere else in "
            "the chart, and importing would merge two different accounts:\n"
            + "\n".join(sorted(clashes)[:20])
            + (f"\n    … and {len(clashes) - 20} more" if len(clashes) > 20 else "")
            + "\nImport into a database that has no demo data (the demo seed mints "
            "client sub-accounts in the same range)."
        )

    added_accounts = 0
    # shortest code first, so a parent is always inserted before its child
    for planned in sorted(plan.accounts.values(), key=lambda a: (len(a.code), a.code)):
        if planned.code in accounts:
            continue
        parent = accounts.get(planned.parent_code) if planned.parent_code else None
        account = Account(
            code=planned.code,
            name_ar=planned.name_ar,
            parent_id=parent.id if parent else None,
            account_type=planned.account_type,
            is_client=planned.is_client,
            is_cash_bank=planned.is_cash_bank,
            is_postable=planned.is_postable,
        )
        db.add(account)
        db.flush()
        accounts[planned.code] = account
        added_accounts += 1

    clients = {c.code: c for c in db.scalars(select(Client)).all() if c.code}
    added_clients = 0
    for planned_client in plan.clients:
        if planned_client.code in clients:
            continue
        client = Client(
            code=planned_client.code,
            name_ar=planned_client.name_ar,
            account_id=accounts[planned_client.account_code].id,
            created_by=actor,
        )
        db.add(client)
        db.flush()
        clients[planned_client.code] = client
        added_clients += 1

    known_rates = {(r.currency_id, r.rate_date) for r in db.scalars(select(ExchangeRate)).all()}
    added_rates = 0
    for code, rate_date, rate in plan.rates:
        key = (currencies[code], rate_date)
        if key in known_rates:
            continue
        db.add(ExchangeRate(currency_id=key[0], rate_date=rate_date, rate_to_base=rate))
        known_rates.add(key)
        added_rates += 1

    known_entries = {
        e.entry_no: e
        for e in db.scalars(
            select(JournalEntry).where(JournalEntry.entry_no.like(f"{ENTRY_PREFIX}%"))
        ).all()
    }
    added_entries = 0
    for planned_entry in plan.entries:
        if planned_entry.entry_no in known_entries:
            continue
        entry = JournalEntry(
            entry_no=planned_entry.entry_no,
            entry_date=planned_entry.entry_date,
            entry_type=planned_entry.entry_type,
            description=planned_entry.description,
            currency_id=currencies[planned_entry.currency_code],
            exchange_rate=planned_entry.exchange_rate,
            is_posted=True,
            created_by=actor,
        )
        for line in planned_entry.lines:
            entry.lines.append(
                JournalLine(
                    account_id=accounts[line.account_code].id,
                    client_id=clients[line.client_code].id if line.client_code else None,
                    debit=line.debit,
                    credit=line.credit,
                    debit_base=line.debit_base,
                    credit_base=line.credit_base,
                    line_desc=line.line_desc,
                )
            )
        db.add(entry)
        known_entries[planned_entry.entry_no] = entry
        added_entries += 1
    db.flush()

    known_receipts = set(
        db.scalars(
            select(Receipt.receipt_no).where(Receipt.receipt_no.like(f"{RECEIPT_PREFIX}%"))
        ).all()
    )
    added_receipts = 0
    for planned_receipt in plan.receipts:
        if planned_receipt.receipt_no in known_receipts:
            continue
        entry = known_entries.get(planned_receipt.entry_no or "")
        db.add(
            Receipt(
                receipt_no=planned_receipt.receipt_no,
                receipt_date=planned_receipt.receipt_date,
                client_id=clients[planned_receipt.client_code].id,
                cash_account_id=accounts[planned_receipt.cash_account_code].id,
                amount=planned_receipt.amount,
                currency_id=currencies[planned_receipt.currency_code],
                exchange_rate=planned_receipt.exchange_rate,
                method=planned_receipt.method,
                cheque_no=planned_receipt.cheque_no,
                journal_entry_id=entry.id if entry else None,
                notes=planned_receipt.notes,
                created_by=actor,
            )
        )
        added_receipts += 1

    known_payments = set(
        db.scalars(
            select(Payment.payment_no).where(Payment.payment_no.like(f"{PAYMENT_PREFIX}%"))
        ).all()
    )
    added_payments = 0
    for planned_payment in plan.payments:
        if planned_payment.payment_no in known_payments:
            continue
        entry = known_entries.get(planned_payment.entry_no or "")
        db.add(
            Payment(
                payment_no=planned_payment.payment_no,
                payment_date=planned_payment.payment_date,
                beneficiary_account_id=accounts[planned_payment.beneficiary_account_code].id,
                cash_account_id=accounts[planned_payment.cash_account_code].id,
                amount=planned_payment.amount,
                currency_id=currencies[planned_payment.currency_code],
                exchange_rate=planned_payment.exchange_rate,
                method=planned_payment.method,
                cheque_no=planned_payment.cheque_no,
                journal_entry_id=entry.id if entry else None,
                notes=planned_payment.notes,
                created_by=actor,
            )
        )
        added_payments += 1

    return {
        "currencies": added_currencies,
        "accounts": added_accounts,
        "clients": added_clients,
        "fx rates": added_rates,
        "entries": added_entries,
        "receipts": added_receipts,
        "payments": added_payments,
    }


def commit(plan: Plan, data_dir: Path) -> None:
    """Open a session, write the whole plan, commit it, and say what landed."""
    from app.database import SessionLocal
    from app.seed import legacy_client_details, legacy_voucher_numbers

    db = SessionLocal()
    try:
        counts = write(plan, db)
        # Phones and project / block / floor from the same customer card, in
        # the same transaction (see legacy_client_details for the columns).
        db.flush()
        filled = legacy_client_details.apply(
            db, legacy_client_details.read_details(data_dir / "ACCOUNTMAP.csv")
        )
        counts["client details"] = sum(filled.values())
        # The number printed on each voucher (MYFNO), which statements show.
        counts["voucher numbers"] = sum(
            legacy_voucher_numbers.apply(db, legacy_voucher_numbers.read_numbers(data_dir)).values()
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print("written")
    for label, count in counts.items():
        print(f"  {label:<10} +{count}")
    print()
    print("The imported ledger keeps the legacy numbering, which is not the starter")
    print("chart's. To carry on posting into the same accounts, set in the root .env:")
    print("  RECEIVABLE_PARENT_CODE=411")
    print("  SALES_REVENUE_CODE=7010002")
    print("  DEFAULT_CASH_CODE=5300002")
    print("Leaving them as they are keeps new business on the starter chart and the")
    print("imported history on the legacy one — two receivable trees in one ledger.")


# ---------------------------------------------------------------------- main


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    default_dir = Path(__file__).resolve().parents[3] / "legacy_data"
    parser.add_argument("--dir", type=Path, default=default_dir, help="folder holding the CSVs")
    parser.add_argument("--commit", action="store_true", help="write to the database")
    parser.add_argument(
        "--force", action="store_true", help="commit even if the reconciliation found differences"
    )
    args = parser.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    tables = read_all(args.dir)
    plan = build_plan(tables)
    problems = reconcile(plan, tables["MIZAN"])
    report(plan, problems, args.dir)

    blocked = bool(plan.errors or problems)
    if not args.commit:
        print("dry run — nothing written. Re-run with --commit to import.")
        return 1 if blocked else 0
    if blocked and not args.force:
        print("refusing to import: resolve the differences above, or re-run with --force.")
        return 1
    commit(plan, args.dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
