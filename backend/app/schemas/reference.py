from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel

# ~400 KB of base64, roughly a 300 KB image — generous for a letterhead and
# small enough that every screen which prints can fetch it with the settings.
LOGO_MAX_CHARS = 550_000

ALLOWED_LOGO_PREFIXES = (
    "data:image/png;base64,",
    "data:image/jpeg;base64,",
    "data:image/jpg;base64,",
    "data:image/webp;base64,",
    "data:image/svg+xml;base64,",
)


class CurrencyOut(ORMModel):
    id: int
    code: str
    name_ar: str
    name_en: str
    symbol: str | None
    is_base: bool


class ExchangeRateOut(ORMModel):
    id: int
    currency_id: int
    rate_date: date
    rate_to_base: Decimal


class ExchangeRateCreate(BaseModel):
    currency_id: int
    rate_date: date
    rate_to_base: Decimal = Field(gt=0)


class OrgSettingsOut(ORMModel):
    """The letterhead every printed document carries."""

    name: str
    subtitle: str | None
    address: str | None
    phone: str | None
    email: str | None
    tax_no: str | None
    footer_note: str | None
    logo: str | None
    updated_at: datetime


class OrgSettingsUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    subtitle: str | None = Field(default=None, max_length=150)
    address: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=60)
    email: str | None = Field(default=None, max_length=120)
    tax_no: str | None = Field(default=None, max_length=60)
    footer_note: str | None = Field(default=None, max_length=255)
    logo: str | None = Field(default=None, max_length=LOGO_MAX_CHARS)

    @field_validator("logo")
    @classmethod
    def _must_be_an_image_data_uri(cls, value: str | None) -> str | None:
        """Only an inline image, and only one small enough to ship on every
        settings fetch — this field is read by every screen that prints."""
        if value in (None, ""):
            return None
        if not value.startswith(ALLOWED_LOGO_PREFIXES):
            raise ValueError("الشعار يجب أن يكون صورة (PNG أو JPEG أو WEBP أو SVG)")
        return value
