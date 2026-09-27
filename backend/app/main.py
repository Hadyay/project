from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import accounts, alerts, auth, cash, clients, contracts, journal, property, reference, reports
from app.config import settings

app = FastAPI(
    title="Real Estate ERP",
    description="نظام إدارة العقارات — buildings, contracts and a full double-entry ledger.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(auth.users_router)
app.include_router(auth.roles_router)
app.include_router(reference.router)
app.include_router(accounts.router)
app.include_router(property.buildings_router)
app.include_router(property.apartments_router)
app.include_router(clients.router)
app.include_router(contracts.router)
app.include_router(cash.receipts_router)
app.include_router(cash.payments_router)
app.include_router(journal.router)
app.include_router(reports.router)
app.include_router(alerts.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
