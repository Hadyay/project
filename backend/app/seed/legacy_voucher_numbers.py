"""Printed voucher numbers for imported receipts and payments.

    python -m app.seed.legacy_voucher_numbers            # dry run
    python -m app.seed.legacy_voucher_numbers --commit   # write

The import names documents after the legacy record id (FNO): LEG-R-5103. The
number on the paper voucher, and on every legacy statement, is MYFNO: 992.
Both are leading columns of RECEIPT.csv / PAYMENT.csv, where the header is
still intact, and are asserted by name before anything is read.

Only empty ref_no fields are filled.
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

NULL = "<null>"
FILES = {"RECEIPT": "LEG-R-", "PAYMENT": "LEG-P-"}


def read_numbers(data_dir: Path) -> dict[str, str]:
    """{"LEG-R-5103": "992", ...} for both files."""
    out: dict[str, str] = {}
    for name, prefix in FILES.items():
        path = data_dir / f"{name}.csv"
        with path.open(encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.reader(fh))
        header = [c.strip() for c in rows[0]]
        if header[0] != "FNO" or header[3] != "MYFNO":
            raise SystemExit(f"{path.name}: expected FNO at 0 and MYFNO at 3, found {header[:4]} - layout changed")
        for row in rows[1:]:
            if len(row) < 4:
                continue
            fno, printed = row[0].strip(), row[3].strip()
            if fno and fno != NULL and printed and printed != NULL:
                out[f"{prefix}{fno}"] = printed
    return out


def apply(db: Session, numbers: dict[str, str]) -> dict[str, int]:
    """Fill ref_no on imported receipts and payments. Does not commit."""
    from app.models import Payment, Receipt

    filled = {"receipts": 0, "payments": 0}
    for receipt in db.scalars(select(Receipt).where(Receipt.receipt_no.in_(numbers.keys()))).all():
        if not receipt.ref_no:
            receipt.ref_no = numbers[receipt.receipt_no]
            filled["receipts"] += 1
    for payment in db.scalars(select(Payment).where(Payment.payment_no.in_(numbers.keys()))).all():
        if not payment.ref_no:
            payment.ref_no = numbers[payment.payment_no]
            filled["payments"] += 1
    return filled


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", default=str(Path(__file__).resolve().parents[3] / "legacy_data"))
    parser.add_argument("--commit", action="store_true", help="write (default is a dry run)")
    args = parser.parse_args()

    numbers = read_numbers(Path(args.data))
    print(f"legacy printed numbers read: {len(numbers)}")

    from app.database import SessionLocal

    with SessionLocal() as db:
        filled = apply(db, numbers)
        print(("filled: " if args.commit else "would fill: ") + ", ".join(f"{k} {v}" for k, v in filled.items()))
        if args.commit:
            db.commit()
            print("committed.")
        else:
            db.rollback()
            print("dry run - nothing written (add --commit).")


if __name__ == "__main__":
    main()
