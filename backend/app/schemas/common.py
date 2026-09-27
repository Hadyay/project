from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class ORMModel(BaseModel):
    """Base for every response schema read straight off a SQLAlchemy row."""

    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    """Envelope for list endpoints: rows plus the total matching count."""

    items: list[T]
    total: int
    limit: int
    offset: int


class Message(BaseModel):
    detail: str
