import os
from collections.abc import Generator

# The tests seed the starter chart (seed_accounts), so the special accounts
# must point at it. Set before `app` is imported: settings are read once, and
# backend/.env points them at the imported legacy chart (411, 7010002, …),
# where creating a client fails because 411 does not exist here.
os.environ.update(
    RECEIVABLE_PARENT_CODE="4110",
    SALES_REVENUE_CODE="5110",
    RENT_REVENUE_CODE="5120",
    DEFAULT_CASH_CODE="1110",
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.security import hash_password
from app.database import get_db
from app.main import app
from app.models import Base, Role, User
from app.seed.run import seed_accounts, seed_currencies, seed_roles

# Integration tests need a real Postgres: the schema uses native enums, JSONB
# and partial indexes, none of which SQLite can stand in for.
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL", "postgresql+psycopg://erp:erp_dev_password@localhost:5432/realestate_erp_test"
)


def _database_reachable() -> bool:
    try:
        engine = create_engine(TEST_DATABASE_URL)
        with engine.connect():
            return True
    except Exception:
        return False


requires_db = pytest.mark.skipif(
    not _database_reachable(), reason=f"No test database at {TEST_DATABASE_URL}"
)


@pytest.fixture(scope="session")
def engine():
    if not _database_reachable():
        pytest.skip(f"No test database at {TEST_DATABASE_URL}")
    return create_engine(TEST_DATABASE_URL)


@pytest.fixture
def db(engine) -> Generator[Session, None, None]:
    """A clean schema per test: drop everything, rebuild from the models."""
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    Base.metadata.create_all(engine)
    # Dropping the schema also drops the native enum types, but pooled
    # connections keep the old type OIDs cached and then fail with
    # "cache lookup failed for type ...". Start each test on fresh ones.
    engine.dispose()

    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = factory()
    try:
        seed_currencies(session)
        seed_accounts(session)
        seed_roles(session)
        admin_role = session.query(Role).filter(Role.code == "admin").one()
        session.add(
            User(
                username="tester",
                password_hash=hash_password("secret123"),
                full_name="Tester",
                role_id=admin_role.id,
            )
        )
        session.commit()
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db: Session) -> Generator[TestClient, None, None]:
    """TestClient wired to the same session the test holds, so both see the
    same uncommitted state."""

    def _override() -> Generator[Session, None, None]:
        yield db

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def auth(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/auth/login", data={"username": "tester", "password": "secret123"}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
