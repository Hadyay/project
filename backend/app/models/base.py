import enum

from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------- ENUM types
# Mirrors the CREATE TYPE ... AS ENUM statements in realestate_erp_schema.sql.
# Each python enum's VALUE (not name) matches the Postgres label exactly.


class AccountType(str, enum.Enum):
    asset = "asset"
    liability = "liability"
    equity = "equity"
    revenue = "revenue"
    expense = "expense"


class ApartmentType(str, enum.Enum):
    apartment = "apartment"
    shop = "shop"
    office = "office"
    storage = "storage"
    land = "land"
    other = "other"


class ApartmentStatus(str, enum.Enum):
    available = "available"
    reserved = "reserved"
    sold = "sold"
    rented = "rented"
    unavailable = "unavailable"


class ContractType(str, enum.Enum):
    sale = "sale"
    rent = "rent"


class ContractStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    completed = "completed"
    cancelled = "cancelled"
    terminated = "terminated"


class ScheduleStatus(str, enum.Enum):
    pending = "pending"
    partial = "partial"
    paid = "paid"
    overdue = "overdue"
    cancelled = "cancelled"


class EntryType(str, enum.Enum):
    opening = "opening"
    sale = "sale"
    rent_invoice = "rent_invoice"
    receipt = "receipt"
    payment = "payment"
    adjustment = "adjustment"
    transfer = "transfer"


class PaymentMethod(str, enum.Enum):
    cash = "cash"
    bank_transfer = "bank_transfer"
    cheque = "cheque"
    card = "card"
    other = "other"


def pg_enum(py_enum: type[enum.Enum], pg_name: str) -> SAEnum:
    """SQLAlchemy Enum column type bound to an existing/managed Postgres native enum."""
    return SAEnum(py_enum, name=pg_name, values_callable=lambda e: [m.value for m in e])
