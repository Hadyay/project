"""Idempotent seed: currencies, chart of accounts, and an admin user.

    python -m app.seed.run                     # safe to re-run
    python -m app.seed.run --admin-password s3cret
"""

import argparse
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.database import SessionLocal
from app.core.permissions import DEFAULT_ROLES, SYSTEM_ROLE_CODE
from app.models import Account, Currency, Role, User
from app.seed.chart_of_accounts import ACCOUNTS

CURRENCIES = [
    ("USD", "دولار", "US Dollar", "$", True),
    ("LBP", "ليرة", "Lebanese Pound", "ل.ل", False),
    ("EUR", "يورو", "Euro", "€", False),
]


def seed_currencies(db: Session) -> int:
    added = 0
    for code, name_ar, name_en, symbol, is_base in CURRENCIES:
        if db.scalars(select(Currency).where(Currency.code == code)).one_or_none():
            continue
        db.add(Currency(code=code, name_ar=name_ar, name_en=name_en, symbol=symbol, is_base=is_base))
        added += 1
    db.flush()
    return added


def seed_accounts(db: Session) -> int:
    """Insert the starter chart, deriving each parent from the code prefix."""
    by_code: dict[str, Account] = {
        a.code: a for a in db.scalars(select(Account)).all()
    }

    added = 0
    for code, name_ar, name_en, account_type, is_cash_bank, is_client, is_postable in ACCOUNTS:
        if code in by_code:
            continue

        # Longest already-seeded code that is a strict prefix of this one.
        parent_code = max(
            (c for c in by_code if len(c) < len(code) and code.startswith(c)),
            key=len,
            default=None,
        )
        account = Account(
            code=code,
            name_ar=name_ar,
            name_en=name_en,
            parent_id=by_code[parent_code].id if parent_code else None,
            account_type=account_type,
            is_cash_bank=is_cash_bank,
            is_client=is_client,
            is_postable=is_postable,
        )
        db.add(account)
        db.flush()
        by_code[code] = account
        added += 1

    return added


def seed_roles(db: Session) -> int:
    """The starting roles (app/core/permissions.DEFAULT_ROLES). Existing roles
    are left alone: once created, a role belongs to the administrator."""
    existing = set(db.scalars(select(Role.code)).all())
    added = 0
    for spec in DEFAULT_ROLES:
        if spec["code"] in existing:
            continue
        db.add(Role(**spec))
        added += 1
    db.flush()
    return added


def seed_admin(db: Session, username: str, password: str) -> bool:
    if db.scalars(select(User).where(User.username == username)).one_or_none():
        return False
    admin_role = db.scalars(select(Role).where(Role.code == SYSTEM_ROLE_CODE)).one()
    db.add(
        User(
            username=username,
            password_hash=hash_password(password),
            full_name="مدير النظام",
            role_id=admin_role.id,
        )
    )
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed reference data for the Real Estate ERP")
    parser.add_argument("--admin-username", default="admin")
    parser.add_argument("--admin-password", default="admin123")
    args = parser.parse_args()

    with SessionLocal() as db:
        currencies = seed_currencies(db)
        accounts = seed_accounts(db)
        seed_roles(db)
        admin = seed_admin(db, args.admin_username, args.admin_password)
        db.commit()

    print(f"currencies added: {currencies}")
    print(f"accounts added:   {accounts}")
    print(f"admin created:    {admin} ({args.admin_username})")
    if admin and args.admin_password == "admin123":
        print("\n  WARNING: the default admin password is in use — change it before going live.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
