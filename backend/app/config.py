from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://erp:erp_dev_password@localhost:5432/realestate_erp"

    jwt_secret: str = "change_me_dev_secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480

    backend_cors_origins: str = "http://localhost:3000"

    # --- Chart-of-accounts wiring -------------------------------------------
    # Codes follow the legacy ACCOUNTMAP numbering (411… = client receivables).
    # The seed script creates these; services look them up by code so the GL
    # postings stay declarative rather than hard-coding primary keys.
    receivable_parent_code: str = "4110"       # parent of per-client receivables
    sales_revenue_code: str = "5110"           # إيرادات المبيعات
    rent_revenue_code: str = "5120"            # إيرادات الإيجارات
    default_cash_code: str = "1110"            # الصندوق

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.backend_cors_origins.split(",") if o.strip()]


settings = Settings()
