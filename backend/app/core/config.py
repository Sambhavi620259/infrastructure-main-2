"""Implementation file: app/core/config.py"""
import os
from typing import List, Union
from pydantic import AnyHttpUrl, validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PROJECT_NAME: str = "ITAM Enterprise API"
    API_V1_STR: str = "/api"
    
    # Server configuration
    SERVER_HOST: str = "0.0.0.0"
    SERVER_PORT: int = 8000
    
    # Database Connection
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "postgresql://itam_user:itam_password@localhost:5432/itam_db"
    )

    # JWT Security settings
    SECRET_KEY: str = os.getenv(
        "JWT_SECRET", 
        "production-itam-super-secret-key-change-me-2026"
    )
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12  # 12 Hours session lifetime

    # CORS Configuration
    CORS_ORIGINS: Union[str, List[str]] = os.getenv(
        "CORS_ORIGINS", 
        "http://localhost:3000,http://127.0.0.1:3000"
    )

    @validator("CORS_ORIGINS", pre=True)
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, (list, str)):
            return v
        raise ValueError(v)

    class Config:
        case_sensitive = True
        env_file = ".env"


settings = Settings()