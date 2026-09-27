from typing import Annotated, Any, TypeVar

from fastapi import Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

T = TypeVar("T")


# The list screens offer "الكل" (all rows), which asks for this many. It must
# stay above any list the office can produce — 2,231 journal entries and
# 2,041 receipts today — and equal ALL_ROWS in frontend/src/lib/paging.ts.
MAX_PAGE_SIZE = 10_000


class PageParams(BaseModel):
    limit: int = 50
    offset: int = 0


def page_params(
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> PageParams:
    return PageParams(limit=limit, offset=offset)


Paging = Annotated[PageParams, Depends(page_params)]


def paginate(db: Session, stmt: Select, paging: PageParams) -> tuple[list[Any], int]:
    """Run `stmt` for one page and return (rows, total-matching-count)."""
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = db.execute(stmt.limit(paging.limit).offset(paging.offset)).scalars().all()
    return list(rows), total


def get_or_404(db: Session, model: type[T], row_id: int, *, name: str | None = None) -> T:
    row = db.get(model, row_id)
    label = name or model.__name__
    if row is None or getattr(row, "is_deleted", False):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} {row_id} not found")
    return row


def apply_updates(row: Any, payload: BaseModel) -> dict[str, Any]:
    """Apply only the fields the client actually sent; return what changed."""
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(row, field, value)
    return changes
