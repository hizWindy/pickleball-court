---
name: kaira-db-migrations
description: Use this skill whenever database schema changes, revisions, table migrations, or Alembic updates are needed in this project.
---

# Database Migrations in pikol-bknd

This project manages relational database schema evolution using Alembic wrapped by Kaira CLI commands.

---

## 1. Create a Migration Revision

After adding a model or altering column fields in `models/`, generate a new migration file:

```bash
kaira migrate make "<description_of_changes>"
```

* **Shortcut:** `kaira mm "<description_of_changes>"`

### What Kaira Does:
* Compares your SQLAlchemy models in `models/` against the live database.
* Generates a timestamped revision file inside `alembic/versions/`.

---

## 2. Review the Migration Script

Always inspect the generated file in `alembic/versions/*.py` before applying it. Ensure:
- No unintentional `drop_table` operations occurred.
- Column types and foreign key constraints match expectations.

---

## 3. Apply Migrations to the Database

To run all pending migrations up to the latest revision (`head`):

```bash
kaira migrate run
```

* **Shortcut:** `kaira mr`

---

## Invariant Safety Rules for AI Assistants

- **Destructive Commands:** Commands like `db reset` or `migrate rollback` require manual confirmation and **NEVER** have CLI shortcuts. Do not execute them without explicit developer consent.
- Always run `kaira status` (or `kaira st`) to verify current database connectivity and pending migrations.