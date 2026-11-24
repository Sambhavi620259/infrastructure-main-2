"""Implementation file: app/main.py"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware

from app.core.access_guard import ScopedRoleWriteGuard
from app.core.config import settings
from app.core.http_guard import BodySizeLimitMiddleware, OriginVerifyMiddleware, SecurityHeadersMiddleware
from app.core.database import engine, get_db
from app.core.logging_config import configure_logging
from app.core.seed import seed_initial_users
from app.services.warranty_alerts import warranty_alert_loop
from app.routers import (
    access,
    approvals,
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
    if int(os.getenv("WEB_CONCURRENCY", "1")) > 1:
        logging.getLogger("app").warning(
            "WEB_CONCURRENCY > 1: sign-in limits and live-update sockets are kept per process, so "
            "the effective limits multiply and updates reach only some viewers. Use one worker."
        )
    # Schema is owned by Alembic (see backend/migrations/README.md).
    # Run `alembic upgrade head` before starting; create_all is deliberately gone
    # so migrations are the single source of truth.
    if settings.ORIGIN_VERIFY_SECRET:
        logging.getLogger("app").info("Origin verification is on: requests need the X-Origin-Verify header from CloudFront.")
    elif settings.is_production:
        logging.getLogger("app").warning(
            "ORIGIN_VERIFY_SECRET is not set: this API accepts requests that did not come through CloudFront."
        )
    seed_initial_users()
    warranty_task = asyncio.create_task(warranty_alert_loop())
    logging.getLogger("app").info(
        "ITAM API started (environment=%s, database=%s).",
        settings.ENVIRONMENT, engine.url.render_as_string(hide_password=True).split("@")[-1],
    )
    yield
    logging.getLogger("app").info("ITAM API shutting down.")
    warranty_task.cancel()
    try:
        await warranty_task
    except asyncio.CancelledError:
        pass
    engine.dispose()
    logging.getLogger("app").info("ITAM API stopped.")

# The interactive API docs are for development; production does not publish the schema.
_docs = {} if not settings.is_production else {"docs_url": None, "redoc_url": None, "openapi_url": None}
app = FastAPI(title="ITAM API", lifespan=lifespan, **_docs)

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
# Outermost last: the size limit and headers wrap everything above them.
app.add_middleware(BodySizeLimitMiddleware)
# Refuses requests that did not come through CloudFront (only when ORIGIN_VERIFY_SECRET is set).
app.add_middleware(OriginVerifyMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

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
app.include_router(approvals.router, prefix="/api")
app.include_router(access.router, prefix="/api")

logger = logging.getLogger("app")


@app.exception_handler(IntegrityError)
async def integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
    """A database constraint stopped the change (duplicate, or still referenced): a conflict, not a crash."""
    logger.warning("Integrity error on %s %s: %s", request.method, request.url.path, str(exc.orig)[:200])
    return JSONResponse(
        status_code=409,
        content={"detail": "This change conflicts with existing data (a duplicate, or the record is still in use)."},
    )


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    """Log the full error server-side; give the client a plain JSON message."""
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong on the server. Please try again; if it keeps happening, contact support."},
    )


@app.get("/api/health/live")
def health_live():
    """Liveness: the process is up and serving. Does not touch the database."""
    return {"status": "ok"}


@app.get("/api/health/ready")
@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    """Readiness: the process is up and the database answers. 503 when the database cannot be reached.
    (/api/health is kept as an alias of /api/health/ready for existing monitors and Docker.)"""
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        logging.getLogger(__name__).exception("Health check: the database is unavailable.")
        return JSONResponse(status_code=503, content={"status": "unavailable"})
    return {"status": "ok"}
