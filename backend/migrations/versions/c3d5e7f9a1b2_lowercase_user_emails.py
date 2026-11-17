"""Store user emails in lower case

Sign-in and registration compare emails case-insensitively now. Existing rows are
lower-cased here unless that would make two accounts share an address, in which
case those rows are left alone for an administrator to sort out.

Revision ID: c3d5e7f9a1b2
Revises: b2c4d6e8f0a1
Create Date: 2026-11-17 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c3d5e7f9a1b2'
down_revision: Union[str, None] = 'b2c4d6e8f0a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE users SET email = lower(email)
        WHERE email <> lower(email)
          AND NOT EXISTS (
              SELECT 1 FROM users other
              WHERE lower(other.email) = lower(users.email) AND other.id <> users.id
          )
    """)


def downgrade() -> None:
    # The original capitalisation is not kept; nothing to restore.
    pass
