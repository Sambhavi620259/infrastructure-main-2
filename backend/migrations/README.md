# Database migrations

Schema changes go through Alembic. `Base.metadata.create_all()` in `app/main.py`
only ever creates _missing tables_ — it never adds a column to a table that
already exists — so before this directory existed there was no way to evolve the
schema short of dropping the database.

## Adopting this on an existing database

Run from `backend/`, with the virtualenv active and Postgres up.

```
alembic revision --autogenerate -m "initial schema"
alembic stamp head
```

The first command writes a migration describing the schema as it stands today.
The second records that revision as already applied, without executing it —
correct here because the existing database was built by `create_all` and already
matches. Review the generated file before stamping.

On a database that does not exist yet, use `alembic upgrade head` in place of
`stamp head`.

## Everyday use

```
alembic revision --autogenerate -m "describe the change"   # after editing models
alembic upgrade head                                        # apply
alembic downgrade -1                                        # roll back one
alembic current                                             # what is applied
```

Always read the generated migration. Autogenerate detects added and dropped
tables and columns and most type changes, but it does not detect renames — those
arrive as a drop plus an add, which destroys data unless edited by hand.

## Outstanding

`app/main.py` still calls `Base.metadata.create_all(bind=engine)` on startup.
Once the steps above have been run and verified, that call should be removed so
migrations are the single source of truth for schema.
