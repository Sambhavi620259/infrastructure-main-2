"""Implementation file: app/main.py"""
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware

from app.core.access_guard import ScopedRoleWriteGuard
from app.core.config import settings
from app.core.database import get_db
from app.core.logging_config import configure_logging
from app.core.seed import seed_initial_users
from app.services.warranty_alerts import warranty_alert_loop
from app.routers import (
    auth,
    users,
    departments,
    assets,
    asset_requests,
    inventory,
    software,
    vendors,
    purchase_orders,
    maintenance,
    warranty_maintenance,
    dashboard,
    reports,
    financial,
    depreciation,
    discovery,
    cloud,
    audit,
    audit_logs,
    super_admin,
    organization,
    notifications,
    profile,
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    settings.check_production_safety()
    # Schema is owned by Alembic (see backend/migrations/README.md).
    # Run `alembic upgrade head` before starting; create_all is deliberately gone
    # so migrations are the single source of truth.
    seed_initial_users()
    warranty_task = asyncio.create_task(warranty_alert_loop())
    yield
    warranty_task.cancel()

app = FastAPI(title="ITAM API", lifespan=lifespan)

# Configure CORS for frontend connection
# The browser normally reaches the API through the Next.js proxy (same origin),
# so CORS only matters for direct calls; allow just the configured origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(ScopedRoleWriteGuard)

# Include routers
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(departments.router, prefix="/api")
app.include_router(assets.router, prefix="/api")
app.include_router(asset_requests.router, prefix="/api")
app.include_router(inventory.router, prefix="/api")
app.include_router(software.router, prefix="/api")
app.include_router(vendors.router, prefix="/api")
app.include_router(purchase_orders.router, prefix="/api")
app.include_router(maintenance.router, prefix="/api")
app.include_router(warranty_maintenance.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(financial.router, prefix="/api")
app.include_router(depreciation.router, prefix="/api")
app.include_router(discovery.router, prefix="/api")
app.include_router(cloud.router, prefix="/api")
app.include_router(audit.router, prefix="/api")
app.include_router(audit_logs.router, prefix="/api")
app.include_router(super_admin.router, prefix="/api")
app.include_router(organization.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(profile.router, prefix="/api")

logger = logging.getLogger("app")


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    """Log the full error server-side; give the client a plain JSON message."""
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong on the server. Please try again; if it keeps happening, contact support."},
    )


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    """Liveness and database check for load balancers and Docker."""
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
