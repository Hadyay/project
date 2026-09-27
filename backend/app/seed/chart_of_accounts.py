"""Starter chart of accounts, keyed to the legacy ACCOUNTMAP numbering.

Shape: (code, name_ar, name_en, account_type, flags). `parent` is derived from
the code prefix, so adding a child only needs a longer code.
"""

from app.models import AccountType

# (code, name_ar, name_en, type, is_cash_bank, is_client, is_postable)
ACCOUNTS: list[tuple[str, str, str, AccountType, bool, bool, bool]] = [
    # ---- 1 assets ---------------------------------------------------------
    ("1", "الأصول", "Assets", AccountType.asset, False, False, False),
    ("11", "الأصول المتداولة", "Current Assets", AccountType.asset, False, False, False),
    ("1110", "الصندوق", "Cash on Hand", AccountType.asset, True, False, True),
    ("1120", "المصارف", "Banks", AccountType.asset, False, False, False),
    ("11200001", "حساب المصرف — دولار", "Bank Account — USD", AccountType.asset, True, False, True),
    ("11200002", "حساب المصرف — ليرة", "Bank Account — LBP", AccountType.asset, True, False, True),
    ("12", "الأصول الثابتة", "Fixed Assets", AccountType.asset, False, False, False),
    ("1210", "العقارات", "Real Estate", AccountType.asset, False, False, True),
    # ---- 2 liabilities ----------------------------------------------------
    ("2", "الخصوم", "Liabilities", AccountType.liability, False, False, False),
    ("2110", "الدائنون", "Payables", AccountType.liability, False, False, True),
    ("2120", "تأمينات الإيجار", "Rent Deposits Held", AccountType.liability, False, False, True),
    # ---- 3 equity ---------------------------------------------------------
    ("3", "حقوق الملكية", "Equity", AccountType.equity, False, False, False),
    ("3110", "رأس المال", "Capital", AccountType.equity, False, False, True),
    ("3120", "الأرباح المدورة", "Retained Earnings", AccountType.equity, False, False, True),
    # ---- 4 receivables (clients live here, as in the old system) ----------
    ("4", "الذمم", "Receivables", AccountType.asset, False, False, False),
    ("4110", "ذمم العملاء", "Client Receivables", AccountType.asset, False, False, False),
    # ---- 5 revenue --------------------------------------------------------
    ("5", "الإيرادات", "Revenue", AccountType.revenue, False, False, False),
    ("5110", "إيرادات المبيعات", "Sales Revenue", AccountType.revenue, False, False, True),
    ("5120", "إيرادات الإيجارات", "Rental Revenue", AccountType.revenue, False, False, True),
    ("5190", "إيرادات أخرى", "Other Revenue", AccountType.revenue, False, False, True),
    # ---- 6 expenses -------------------------------------------------------
    ("6", "المصاريف", "Expenses", AccountType.expense, False, False, False),
    ("6110", "الرواتب", "Salaries", AccountType.expense, False, False, True),
    ("6120", "الصيانة", "Maintenance", AccountType.expense, False, False, True),
    ("6130", "الكهرباء والماء", "Utilities", AccountType.expense, False, False, True),
    ("6140", "العمولات", "Commissions", AccountType.expense, False, False, True),
    ("6190", "مصاريف أخرى", "Other Expenses", AccountType.expense, False, False, True),
]
