"""Client details from the legacy customer card: phones and where they bought.

    python -m app.seed.legacy_client_details            # dry run: what would change
    python -m app.seed.legacy_client_details --commit   # write

ACCOUNTMAP is a fixed-width dump that was comma-split after the fact, so past
the leading columns its header is mush (see legacy_import.Table). The client
rows still split the same way every time - 57 fields each - and the columns
below were identified against the office's printed balance report
("كشف الأرصدة حسب عملة الحساب"): every value lines up with a client there.

    22  CONTACT   المشروع والعقار   "الهدفة 432"
    27  STEL1     هاتف              "81007145"
    28  STEL2     هاتف ٢
    30  EMAIL     طابق / جهة        "اول غربي"    (the old system reused EMAIL)
    45  "SMOB2    CONTACT2"         "<null>      بلوك B3"   -> block after the gap

Only empty fields are filled: a value someone has since typed in the app wins.
"""

from __future__ import annotations

import argparse
import csv
import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.seed import legacy_map

NULL = "<null>"
ROW_WIDTH = 57
HEADER_AT = {22: "CONTACT", 27: "STEL1", 28: "STEL2", 30: "EMAIL"}
BLOCK_COLUMN = 45
BLOCK_HEADER_PREFIX = "SMOB2"
FIELDS = ("phone", "phone2", "project", "block", "floor_side")


@dataclass
class ClientDetails:
    phone: str | None
    phone2: str | None
    project: str | None
    block: str | None
    floor_side: str | None


def _clean(value: str) -> str | None:
    value = " ".join(value.split())
    return None if value in ("", NULL) else value


def _block(value: str) -> str | None:
    # "SMOB2" and "CONTACT2" share one comma field, separated by padding.
    m = re.match(r"^\S+\s{2,}(.+)$", value.strip())
    return _clean(m.group(1)) if m else None


def read_details(path: Path) -> dict[str, ClientDetails]:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.reader(fh))
    header = [c.strip() for c in rows[0]]
    for i, name in HEADER_AT.items():
        if header[i] != name:
            raise SystemExit(f"{path.name}: column {i} is {header[i]!r}, expected {name!r} - layout changed")
    if not header[BLOCK_COLUMN].startswith(BLOCK_HEADER_PREFIX):
        raise SystemExit(f"{path.name}: column {BLOCK_COLUMN} is {header[BLOCK_COLUMN]!r} - layout changed")

    out: dict[str, ClientDetails] = {}
    for row in rows[1:]:
        if not row or not legacy_map.is_client_code(row[0].strip()):
            continue
        if len(row) != ROW_WIDTH:
            raise SystemExit(f"{path.name}: client {row[0]} has {len(row)} fields, expected {ROW_WIDTH}")
        out[row[0].strip()] = ClientDetails(
            phone=_clean(row[27]),
            phone2=_clean(row[28]),
            project=_clean(row[22]),
            block=_block(row[BLOCK_COLUMN]),
            floor_side=_clean(row[30]),
        )
    return out


def apply(db: Session, details: dict[str, ClientDetails]) -> dict[str, int]:
    """Fill empty fields on existing clients. Does not commit."""
    from app.models import Client

    filled = {field: 0 for field in FIELDS}
    for client in db.scalars(select(Client).where(Client.code.in_(details.keys()))).all():
        found = details[client.code]
        for field in FIELDS:
            value = getattr(found, field)
            if value and not getattr(client, field):
                setattr(client, field, value)
                filled[field] += 1
    return filled


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", default=str(Path(__file__).resolve().parents[3] / "legacy_data"))
    parser.add_argument("--commit", action="store_true", help="write (default is a dry run)")
    args = parser.parse_args()

    details = read_details(Path(args.data) / "ACCOUNTMAP.csv")
    print(f"legacy clients read: {len(details)}")
    for field in FIELDS:
        print(f"  with {field:<10}: {sum(1 for d in details.values() if getattr(d, field))}")

    from app.database import SessionLocal

    with SessionLocal() as db:
        filled = apply(db, details)
        print("fields to fill on existing clients:" if not args.commit else "fields filled:")
        for field, n in filled.items():
            print(f"  {field:<10}: {n}")
        if args.commit:
            db.commit()
            print("committed.")
        else:
            db.rollback()
            print("dry run - nothing written (add --commit).")


if __name__ == "__main__":
    main()
