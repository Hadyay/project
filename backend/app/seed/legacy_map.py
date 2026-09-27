"""How legacy codes and labels map onto the new schema.

Kept apart from the import logic so an accountant can review the judgement
calls without reading migration code.

The legacy chart is the Lebanese general accounting plan (المخطط المحاسبي
العام): the leading digit is the account class, and the class determines the
account type. Class 4 (الغير — third parties) is the only one that genuinely
splits both ways, so it gets a two-digit table.
"""

from app.models import AccountType, EntryType

# Leading digit → account type.
#   1 أموال دائمة      permanent capital (equity, long-term debt)
#   2 أصول ثابتة       fixed assets
#   3 مخزون            inventory
#   4 الغير             third parties — see CLASS_4 below
#   5 حسابات مالية      financial accounts (banks, cash)
#   6 أعباء             expenses
#   7 إيرادات           revenue
CLASS_TYPE: dict[str, AccountType] = {
    "1": AccountType.equity,
    "2": AccountType.asset,
    "3": AccountType.asset,
    "5": AccountType.asset,
    "6": AccountType.expense,
    "7": AccountType.revenue,
}

# Class 1 sub-ranges that are debt rather than equity.
CLASS_1_LIABILITY_PREFIXES = ("15", "16", "17", "18")

# Class 4, by two-digit prefix. These are the standard meanings in the
# Lebanese plan; REVIEW THESE with the client's accountant before relying on
# the resulting balance sheet — only 41 (customers) is exercised by this
# dataset, the rest are carried over empty.
CLASS_4: dict[str, AccountType] = {
    "40": AccountType.liability,   # موردون — suppliers
    "41": AccountType.asset,       # زبائن — customers (receivables)
    "42": AccountType.liability,   # مستخدمون — payroll due
    "43": AccountType.liability,   # ضمان اجتماعي — social security
    "44": AccountType.liability,   # الدولة — taxes and duties
    "45": AccountType.liability,   # الشركاء — partners
    "46": AccountType.liability,   # دائنون ومدينون متنوعون
    "47": AccountType.asset,       # حسابات انتظار — suspense
    "48": AccountType.asset,       # حسابات التسوية — accruals
}
CLASS_4_DEFAULT = AccountType.asset

# 428 is money advanced *to* staff, so it sits on the asset side even though
# the rest of 42 is a payable.
CLASS_4_OVERRIDES: dict[str, AccountType] = {
    "428": AccountType.asset,
}

CLIENT_PREFIX = "411"          # فواتير الزبائن — one leaf per customer
CASH_PREFIXES = ("51", "53")   # بنوك / الصندوق


def account_type_for(code: str) -> AccountType:
    """Account type for a legacy SID, from the Lebanese chart's structure."""
    if not code:
        raise ValueError("empty account code")

    for prefix, account_type in CLASS_4_OVERRIDES.items():
        if code.startswith(prefix):
            return account_type

    head = code[0]
    if head == "1":
        if code.startswith(CLASS_1_LIABILITY_PREFIXES):
            return AccountType.liability
        return AccountType.equity
    if head == "4":
        return CLASS_4.get(code[:2], CLASS_4_DEFAULT)

    account_type = CLASS_TYPE.get(head)
    if account_type is None:
        raise ValueError(f"No account class for code {code!r}")
    return account_type


def is_client_code(code: str) -> bool:
    return code.startswith(CLIENT_PREFIX) and len(code) > len(CLIENT_PREFIX)


def is_cash_code(code: str) -> bool:
    return code.startswith(CASH_PREFIXES)


# JOURNAL.DESCR / SACCOUNT.FTYPE → entry_type.
# 'ايرادات' is a revenue posting with no dedicated type of its own; it lands on
# `adjustment` rather than inventing a category the schema does not have.
ENTRY_TYPES: dict[str, EntryType] = {
    "قبض": EntryType.receipt,
    "مبيع": EntryType.sale,
    "صرف": EntryType.payment,
    "ايرادات": EntryType.adjustment,
    "إيرادات": EntryType.adjustment,
    "قيد يومي": EntryType.adjustment,
}
DEFAULT_ENTRY_TYPE = EntryType.adjustment

# Legacy currency names → ISO codes. SCURRENCY.CURRVAL is "units of this
# currency per 1 USD", the inverse of how the new schema stores rates.
CURRENCY_CODES: dict[str, str] = {
    "ليرة": "LBP",
    "دولار": "USD",
    "يورو": "EUR",
    "باوند": "GBP",
}

CURRENCY_NAMES_EN: dict[str, str] = {
    "LBP": "Lebanese Pound",
    "USD": "US Dollar",
    "EUR": "Euro",
    "GBP": "British Pound",
}

CURRENCY_SYMBOLS: dict[str, str] = {
    "LBP": "ل.ل",
    "USD": "$",
    "EUR": "€",
    "GBP": "£",
}

# DTYPE in SACCOUNT: م = مدين (debit), د = دائن (credit). The amount columns
# already carry the side, so this is only used as a consistency check.
DEBIT_MARKER = "م"
CREDIT_MARKER = "د"

# MIZAN omits this account entirely even though SACCOUNT posts to it, so the
# reconciliation is expected to differ here and nowhere else.
KNOWN_MIZAN_GAPS = {"4427001"}
