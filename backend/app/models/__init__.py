"""SQLAlchemy models — import every module here so `Base.metadata` is complete.

Alembic autogenerate and `Base.metadata.create_all` both rely on this.
"""

from app.models.accounts import Account
from app.models.audit import AuditLog
from app.models.base import (
    AccountType,
    ApartmentStatus,
    ApartmentType,
    Base,
    ContractStatus,
    ContractType,
    EntryType,
    PaymentMethod,
    ScheduleStatus,
)
from app.models.cash import Payment, Receipt
from app.models.clients import Client
from app.models.contracts import Contract, PaymentSchedule
from app.models.ledger import JournalEntry, JournalLine
from app.models.property import Apartment, Building
from app.models.reference import Currency, ExchangeRate, Role, User
from app.models.settings import AlertSettings, ClientReminder, OrgSettings

__all__ = [
    "Account",
    "AccountType",
    "Apartment",
    "ApartmentStatus",
    "ApartmentType",
    "AuditLog",
    "Base",
    "Building",
    "Client",
    "Contract",
    "ContractStatus",
    "ContractType",
    "Currency",
    "EntryType",
    "ExchangeRate",
    "JournalEntry",
    "JournalLine",
    "OrgSettings",
    "AlertSettings",
    "ClientReminder",
    "Payment",
    "PaymentMethod",
    "PaymentSchedule",
    "Receipt",
    "ScheduleStatus",
    "User",
    "Role",
]
