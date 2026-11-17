"""Implementation file: app/core/config.py"""
import os
from typing import List, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_DEFAULT_SECRET = "production-itam-super-secret-key-change-me-2026"


class Settings(BaseSettings):
    PROJECT_NAME: str = "ITAM Enterprise API"
    # "development" or "production". Production refuses to start with unsafe defaults.
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    API_V1_STR: str = "/api"
    
    # Server configuration
    SERVER_HOST: str = "0.0.0.0"
    SERVER_PORT: int = 8000
    
    # Database Connection
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "postgresql+psycopg2://itam_user:itam_password@localhost:5432/itam_db"
    )

    # JWT Security settings
    SECRET_KEY: str = os.getenv("JWT_SECRET", _DEFAULT_SECRET)
    ALGORITHM: str = "HS256"
    # Session lifetime; a token also stops working as soon as its owner's password changes.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(60 * 12)))

    # CORS Configuration (Supports both port 3000 and 3001 for Next.js dev server shifts)
    CORS_ORIGINS: Union[str, List[str]] = os.getenv(
        "CORS_ORIGINS", 
        "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001"
    )

    # Optional first Super Admin, created on startup only when both are set and
    # no Super Admin exists yet. Otherwise the first Super Admin registers.
    SEED_SUPER_ADMIN_EMAIL: str = os.getenv("SEED_SUPER_ADMIN_EMAIL", "")
    SEED_SUPER_ADMIN_PASSWORD: str = os.getenv("SEED_SUPER_ADMIN_PASSWORD", "")

    # Attempts per client IP per minute on sign-in and registration.
    AUTH_RATE_LIMIT_PER_MINUTE: int = int(os.getenv("AUTH_RATE_LIMIT_PER_MINUTE", "20"))

    # How many reverse proxies in front of this app each append to X-Forwarded-For.
    # 0 (default) ignores that header and uses the connection's own address, so a
    # caller cannot pick the address the rate limit sees. Behind one proxy use 1;
    # Vercel -> Render use 2.
    TRUSTED_PROXY_COUNT: int = int(os.getenv("TRUSTED_PROXY_COUNT", "0"))
    # Shared secret between the frontend proxy and this API (also set as BACKEND_PROXY_KEY on the
    # frontend). When set, the visitor address is taken only from requests that carry it, so a
    # caller who reaches the API directly cannot choose the address the limits see.
    PROXY_SHARED_SECRET: str = os.getenv("PROXY_SHARED_SECRET", "")
    # Failed sign-ins per account per 15 minutes before the account is paused.
    LOGIN_FAILURE_LIMIT: int = int(os.getenv("LOGIN_FAILURE_LIMIT", "10"))

    # Public sign-up switches. The first Super Admin registers once; IT Admins may
    # self-register unless this is turned off (then a Super Admin adds them).
    ALLOW_PUBLIC_IT_ADMIN_SIGNUP: bool = os.getenv("ALLOW_PUBLIC_IT_ADMIN_SIGNUP", "true").lower() in ("1", "true", "yes")
    ALLOW_PUBLIC_SUPER_ADMIN_SIGNUP: bool = os.getenv("ALLOW_PUBLIC_SUPER_ADMIN_SIGNUP", "true").lower() in ("1", "true", "yes")

    # Largest request body the API accepts, in bytes (file uploads are base64 in JSON).
    MAX_REQUEST_BODY_BYTES: int = int(os.getenv("MAX_REQUEST_BODY_BYTES", str(8 * 1024 * 1024)))

    # Database connections.
    DB_POOL_SIZE: int = int(os.getenv("DB_POOL_SIZE", "10"))
    DB_MAX_OVERFLOW: int = int(os.getenv("DB_MAX_OVERFLOW", "10"))

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"

    def check_production_safety(self) -> None:
        """Fail fast instead of running production with guessable secrets."""
        if not self.is_production:
            return
        problems = []
        if self.SECRET_KEY == _DEFAULT_SECRET or len(self.SECRET_KEY) < 32:
            problems.append("JWT_SECRET must be set to a random value of at least 32 characters")
        if "itam_password" in self.DATABASE_URL:
            problems.append("DATABASE_URL still uses the example database password")
        if any(origin == "*" for origin in self.CORS_ORIGINS):
            problems.append("CORS_ORIGINS must list your real frontend origins, not *")
        if problems:
            raise RuntimeError("Unsafe production configuration: " + "; ".join(problems))

    @field_validator("DATABASE_URL", mode="after")
    @classmethod
    def use_psycopg2_driver(cls, v: str) -> str:
        """Hosts such as Render give postgres:// or postgresql:// URLs; the installed driver is psycopg2."""
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+psycopg2://" + v[len(prefix):]
        return v

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, list):
            return v
        raise ValueError(v)

    model_config = SettingsConfigDict(
        case_sensitive=True,
        env_file=".env",
        extra="ignore"
    )


settings = Settings()