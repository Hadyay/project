import re

from sqlalchemy import func, select
from sqlalchemy.orm import InstrumentedAttribute, Session

_SUFFIX = re.compile(r"(\d+)$")


def next_number(db: Session, column: InstrumentedAttribute, prefix: str, width: int = 4) -> str:
    """Next document number for a `PREFIX-0001` series.

    Scans the existing values on `column` that share the prefix and takes the
    highest numeric suffix. Callers hold the transaction, and the underlying
    column is UNIQUE, so a racing insert fails loudly rather than duplicating.
    """
    existing = db.scalars(
        select(column).where(column.like(f"{prefix}%")).order_by(func.length(column).desc(), column.desc()).limit(1)
    ).one_or_none()

    highest = 0
    if existing:
        match = _SUFFIX.search(existing)
        if match:
            highest = int(match.group(1))

    return f"{prefix}{highest + 1:0{width}d}"
