"""The permission catalog — what a role can be granted.

Access is dynamic: roles live in the database (`roles`), each a set of the
permission codes below, and administrators edit them from الإعدادات. Code only
decides *which* permissions exist and which endpoint needs which; *who* holds
them is data.

A code is "<module>.<action>". Every endpoint is gated — reads included — by
`require_perm(...)` in app/core/deps.py, which passes when the user holds ANY
of the codes given (list endpoints that other screens use as pickers name
those screens' permissions too).

The one fixed role is the system role (`is_system`, code "admin"): it holds
every permission, including ones added to this catalog later, and cannot be
edited or deleted — so the office can never lock itself out.
"""

from __future__ import annotations

# (module, Arabic label, [(action, Arabic label), ...]) — order is the order
# the role editor shows.
CATALOG: list[tuple[str, str, list[tuple[str, str]]]] = [
    ("dashboard", "لوحة التحكم", [("view", "عرض")]),
    ("buildings", "الأبنية", [("view", "عرض"), ("create", "إضافة"), ("edit", "تعديل"), ("delete", "حذف")]),
    ("units", "الشقق والوحدات", [("view", "عرض"), ("create", "إضافة"), ("edit", "تعديل"), ("delete", "حذف")]),
    ("clients", "العملاء وكشوف الحساب", [("view", "عرض"), ("create", "إضافة"), ("edit", "تعديل"), ("delete", "حذف")]),
    (
        "contracts",
        "العقود",
        [("view", "عرض"), ("create", "إضافة"), ("edit", "تعديل"), ("activate", "تفعيل"), ("delete", "حذف")],
    ),
    ("schedule", "جدول الدفعات", [("view", "عرض"), ("manage", "فوترة وتحديث")]),
    ("receipts", "الوصولات — قبض", [("view", "عرض"), ("create", "إضافة"), ("void", "إلغاء المستند")]),
    ("payments", "المدفوعات — صرف", [("view", "عرض"), ("create", "إضافة"), ("void", "إلغاء المستند")]),
    ("journal", "قيود اليومية", [("view", "عرض"), ("create", "إضافة"), ("post", "ترحيل"), ("void", "إلغاء المستند")]),
    ("accounts", "دليل الحسابات", [("view", "عرض"), ("create", "إضافة"), ("edit", "تعديل")]),
    ("reports", "التقارير وميزان المراجعة", [("view", "عرض")]),
    ("alerts", "التنبيهات والتذكير", [("view", "عرض"), ("manage", "تسجيل التذكير")]),
    (
        "settings",
        "الإعدادات",
        [
            ("users", "المستخدمون والأدوار"),
            ("org", "بيانات المنشأة"),
            ("rates", "أسعار الصرف"),
            ("alerts", "إعداد التنبيهات"),
        ],
    ),
]

ALL_PERMISSIONS: frozenset[str] = frozenset(
    f"{module}.{action}" for module, _, actions in CATALOG for action, _ in actions
)

SYSTEM_ROLE_CODE = "admin"

_VIEWS = [f"{module}.view" for module, _, actions in CATALOG if any(a == "view" for a, _ in actions)]

# The roles every new database starts with — the same rights the four fixed
# roles had before access became dynamic (migration 0007 carries a snapshot).
DEFAULT_ROLES: list[dict] = [
    {
        "code": SYSTEM_ROLE_CODE,
        "name": "مدير النظام",
        "description": "كل الصلاحيات — دور ثابت لا يُعدَّل ولا يُحذف.",
        "is_system": True,
        "permissions": [],
    },
    {
        "code": "accountant",
        "name": "محاسب",
        "description": "كل العمليات والقيود والتقارير، دون إدارة المستخدمين وبيانات المنشأة.",
        "is_system": False,
        "permissions": sorted(ALL_PERMISSIONS - {"settings.users", "settings.org"}),
    },
    {
        "code": "sales",
        "name": "مبيعات",
        "description": "الأبنية والوحدات والعملاء والعقود، مع الاطلاع على الباقي.",
        "is_system": False,
        "permissions": sorted(
            set(_VIEWS)
            | {f"{m}.{a}" for m in ("buildings", "units", "clients") for a in ("create", "edit", "delete")}
            | {"contracts.create", "contracts.edit"}
        ),
    },
    {
        "code": "viewer",
        "name": "مطالعة",
        "description": "اطلاع فقط على كل الشاشات.",
        "is_system": False,
        "permissions": sorted(_VIEWS),
    },
]


def catalog_payload() -> list[dict]:
    """The catalog as the role editor reads it."""
    return [
        {
            "module": module,
            "label": label,
            "actions": [{"code": f"{module}.{action}", "action": action, "label": a_label} for action, a_label in actions],
        }
        for module, label, actions in CATALOG
    ]
