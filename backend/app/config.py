from pathlib import Path

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

    # --- Database backups (الإعدادات ← النسخ الاحتياطي) ----------------------
    backup_dir: str = ""                       # default: <project>/db_backup
    backup_auto: bool = True                   # the API makes one a day while it runs
    backup_every_hours: int = 24
    backup_keep_days: int = 30
    backup_keep_min: int = 7                   # never fewer than this, however old
    backup_pg_dump: str = ""                   # pg_dump.exe; searched for when empty
    backup_docker_container: str = "project-db-1"  # the dev PC's Postgres runs in Docker

    @property
    def backup_path(self) -> Path:
        return Path(self.backup_dir) if self.backup_dir else Path(__file__).resolve().parents[2] / "db_backup"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.backend_cors_origins.split(",") if o.strip()]


settings = Settings()
