"""Implementation file: app/main.py"""
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.deps import get_current_user
from app.core.logging_config import configure_logging
from app.core.seed import seed_initial_users
from app.models.models import User
from app.schemas.schemas import UserProfile, UserProfileResponse
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
    admin,
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    # Schema is owned by Alembic (see backend/migrations/README.md).
    # Run `alembic upgrade head` before starting; create_all is deliberately gone
    # so migrations are the single source of truth.
    seed_initial_users()
    yield

app = FastAPI(title="ITAM API", lifespan=lifespan)

# Configure CORS for frontend connection
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
app.include_router(admin.router, prefix="/api")

@app.get("/api/profile", response_model=UserProfileResponse)
def api_profile(current_user: User = Depends(get_current_user)) -> UserProfileResponse:
    department_name = current_user.department.name if current_user.department else None
    return UserProfileResponse(
        user=UserProfile(
            id=current_user.id,
            name=current_user.full_name,
            email=current_user.email,
            role=current_user.role,
            department=department_name,
            companyId=current_user.company_id,
            avatarUrl=None,
        )
    )