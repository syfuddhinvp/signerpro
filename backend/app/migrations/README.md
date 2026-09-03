# Migrations

Alembic is the only source of truth for the schema. The application never calls
`create_all`; the test suite does, but against its own in-memory engine.

```
alembic upgrade head            # apply
alembic downgrade -1            # step back one
alembic revision --autogenerate -m "what changed"
python -m scripts.check_schema_drift   # models vs. live schema, exits 1 on drift
```

## `0001_initial` is now a literal baseline

`0001_initial` used to be a single line:

```python
Base.metadata.create_all(bind=op.get_bind())
```

That made the "initial schema" *whatever the models happened to be at the moment
you ran it*, with three consequences:

* **Drift detection was vacuous.** A fresh database was defined as "the models",
  so `compare_metadata()` could not report a difference no matter how far the
  migrations had drifted from them. A zero-diff result meant nothing.
* **Revisions 2–13 were dead code on a fresh database.** They survived only via
  their 5–20 existence guards apiece, because `create_all` had already made
  everything they were trying to add.
* **Two databases bootstrapped at different commits got different schemas while
  reporting the same `alembic_version`.** Nothing anywhere could detect that.

`0001_initial` now contains explicit `op.create_table` calls, generated from the
model metadata as of commit `8d3316e` — the exact schema the old `create_all`
produced. Every subsequent schema change is its own revision.

Two details worth knowing if you regenerate it:

* Columns typed `EncryptedString` are written as plain `sa.String` of the width
  they actually occupy. `EncryptedString(n)` widens itself to `max(n*3, n+120)`
  in its constructor, so rendering the decorator into a migration re-applies the
  widening and produces a column three times too wide.
* `env.py` installs a `compare_type` hook (`app/migrations/comparators.py`) that
  compares a `TypeDecorator` against the type it actually stores, so
  `EncryptedString` no longer reports a permanent, un-resolvable diff that would
  mask real drift.

## Re-stamping an existing environment

**Nothing needs to be done for any database that is already on this chain.** The
new `0001_initial` emits byte-identical DDL to what `create_all` produced at
`8d3316e`, so a database stamped at *any* revision from `0001_initial` to
`e1a9c3b45d10` is already consistent with it. Run `alembic upgrade head` as
usual and it will apply only `f2b7c81e4a90`.

The procedure below is only for a database whose schema was created some other
way (a `create_all` from application code, a hand-built database, or a restore
whose `alembic_version` table was lost).

1. **Back up.** `pg_dump` the database. Every step below is reversible only from
   that backup.

2. **Find out where it actually is.**

   ```sh
   psql "$DATABASE_URL" -c 'SELECT * FROM alembic_version'
   ```

   * A row naming a revision in this chain → nothing to do; go to step 5.
   * No `alembic_version` table, or a revision this repository does not contain →
     continue.

3. **Establish what the schema contains** so you stamp the right revision.
   Compare against the models:

   ```sh
   python -m scripts.check_schema_drift
   ```

   * **No drift** → the database is at head. Stamp head:
     `alembic stamp head`. Done.
   * **Drift** → work out the newest revision whose changes are *all* already
     present (read the revisions in `alembic history` order and check the
     database for the columns and tables each adds). Stamp that one:

     ```sh
     alembic stamp <revision>
     ```

     Stamping only writes `alembic_version`; it runs no DDL.

4. **Apply the rest.**

   ```sh
   alembic upgrade head
   ```

5. **Verify.** These three together are the check that the old baseline made
   impossible:

   ```sh
   alembic upgrade head            # must be a no-op the second time
   python -m scripts.check_schema_drift   # must print "schema drift: none"
   curl -fsS localhost:8000/api/health/ready | jq .checks.migrations
   ```

   The readiness endpoint compares `alembic_version` against the head the
   running build ships, so a replica serving traffic against a database at the
   wrong revision now reports itself unready instead of failing silently.

If step 3 cannot be resolved confidently, the safe fallback is to dump the data,
build a fresh database with `alembic upgrade head`, and restore data only —
never schema.

## Deploying `f2b7c81e4a90` against a large existing database

The revision drops and recreates all 76 foreign keys (to add `ON DELETE`) and
creates 16 indexes. On an empty or small database this is instantaneous. On a
large production table it is not, and it takes locks:

* `CREATE INDEX` takes a `SHARE` lock, blocking writes to that table.
* Recreating a FK validates every existing row.

If that matters for your data volume, split the revision: run the index creation
separately as `CREATE INDEX CONCURRENTLY` (which cannot run inside a transaction,
so it needs its own revision with `autocommit_block()`), and add the constraints
as `NOT VALID` followed by a separate `VALIDATE CONSTRAINT`. Neither is worth the
complexity while the largest deployment is a demo.
