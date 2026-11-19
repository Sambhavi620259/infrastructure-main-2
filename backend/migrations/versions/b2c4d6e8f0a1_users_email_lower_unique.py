"""users: case-insensitive unique email

Revision ID: b2c4d6e8f0a1
Revises: a9d1e3f5b7c2
Create Date: 2026-11-18 12:00:00.000000

The application already treats emails case-insensitively; this makes the
database enforce it. If two existing accounts differ only by case the upgrade
stops and lists them: merge or rename one, then run it again.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'b2c4d6e8f0a1'
down_revision: Union[str, None] = 'a9d1e3f5b7c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    clashes = bind.execute(sa.text(
        "SELECT lower(email) FROM users GROUP BY lower(email) HAVING count(*) > 1"
    )).fetchall()
    if clashes:
        listed = ", ".join(row[0] for row in clashes)
        raise RuntimeError(
            "Cannot add the case-insensitive email index: these emails exist more than once "
            f"with different capitalization: {listed}. Merge or rename the duplicates first."
        )
    op.create_index("ix_users_email_lower", "users", [sa.text("lower(email)")], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_email_lower", table_name="users")
