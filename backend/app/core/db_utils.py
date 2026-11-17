"""Small database helpers shared by routers."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import Base


def count_references(db: Session, model, row_id: str) -> int:
    """
    How many rows in other tables point at this row through a foreign key, so a
    delete can be refused with a clear message instead of failing at the database.
    """
    target = model.__table__
    total = 0
    for table in Base.metadata.tables.values():
        for foreign_key in table.foreign_keys:
            if foreign_key.column.table is target and foreign_key.column.name == "id":
                total += db.execute(
                    select(func.count()).select_from(table).where(table.c[foreign_key.parent.name] == row_id)
                ).scalar() or 0
    return total
