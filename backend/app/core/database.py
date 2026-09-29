"""Implementation file: app/core/database.py"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.core.config import settings

# Initialize Database Engine
engine = create_engine(
    settings.DATABASE_URL, 
    pool_pre_ping=True, 
    pool_size=15, 
    max_overflow=25
)

# Session Factory
SessionLocal = sessionmaker(
    autocommit=False, 
    autoflush=False, 
    bind=engine
)

# Base ORM Model Class
Base = declarative_base()


def get_db():
    """
    FastAPI dependency that yields a SQLAlchemy database session
    and guarantees closing it after the request completes.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()