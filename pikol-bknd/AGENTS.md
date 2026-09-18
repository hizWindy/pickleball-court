# AGENTS.md — pikol-bknd Guidelines

> **Target Audience:** AI Coding Assistants (Antigravity, Claude Code, Cursor, Copilot) working on this application.

Welcome to **pikol-bknd**, a FastAPI backend application scaffolded with **Kaira**. 
This guide outlines the architectural rules, directory responsibilities, and workflows to follow when making changes or adding features.

---

## 1. Tech Stack Overview

- **Framework**: FastAPI (`fastapi[standard]`)
- **Python**: 3.10+
- **Database**: postgresql
- **ORM/ODM**: SQLAlchemy 2.0 (Async) with Alembic migrations
- **Validation**: Pydantic v2
- **Auth**: jwt
- **Logging**: Loguru structured logging
- **Testing**: Pytest

---

## 2. Directory Layout & The 5-Layer Pattern

This project strictly adheres to a **5-layer clean architecture**. When adding endpoints, models, or logic, preserve this separation:

```text
pikol-bknd/
├── models/             # 1. ORM/ODM Models (Data structure & table/collection schema)
├── repositories/       # 2. Data Access Layer (DB queries, filtering, CRUD operations)
├── schemas/            # 3. Validation Schemas (Pydantic v2 Base, Create, Update, Response)
├── services/           # 4. Business Logic Layer (Domain rules, transactions, HTTPExceptions)
├── routers/            # 5. API Endpoints (FastAPI routing, parameter parsing, Depends)
├── auth/               # Authentication handlers, JWT dependencies & password utilities
├── config/             # Settings (pydantic-settings loaded from .env)
├── core/               # Database connection engine, session management, and logger
├── middleware/         # Rate limiting, security headers, CORS, error handling
├── tests/              # Pytest test suite (unit, service, integration)
├── main.py             # FastAPI app initialization & router registration
└── .kaira.json         # Kaira project metadata & generated model tracker
```

---

## 3. Strict Rules for AI Assistants

### A. Layer Responsibilities & Prohibitions
1. **Routers (`routers/`)**:
   - **Allowed**: Route definitions (`@router.get`, `@router.post`), dependency injection (`Depends`), query/path parsing, HTTP status codes.
   - **Prohibited**: NEVER perform raw database queries or ORM lookups in routers. NEVER place complex domain/business calculations in routers. Delegate everything to the corresponding **Service**.
2. **Services (`services/`)**:
   - **Allowed**: Business logic, workflow coordination across multiple repositories, raising `HTTPException` (e.g. 400 Bad Request, 404 Not Found, 409 Conflict).
   - **Prohibited**: Do not write raw SQL or low-level ORM sessions directly here if a repository method can handle it.
3. **Repositories (`repositories/`)**:
   - **Allowed**: CRUD operations, complex queries, joins, sorting, pagination, and database error handling.
   - **Prohibited**: NEVER raise `fastapi.HTTPException` in repositories. Repositories should return `None` or raise domain/database exceptions. Let the service layer translate outcomes to HTTP responses.
4. **Schemas (`schemas/`)**:
   - Always define Pydantic v2 models: `<Entity>Base`, `<Entity>Create`, `<Entity>Update`, and `<Entity>Response`.
   - Set `model_config = ConfigDict(from_attributes=True)` on response schemas.
5. **Models (`models/`)**:
   - Define SQLAlchemy declarative models using typed `Mapped[...]` and `mapped_column(...)`.

---

## 4. Working with Kaira CLI

Whenever possible, use the **Kaira CLI** (or its shortcuts) to generate, sync, and migrate models consistently:

| Task | Command | Shortcut |
|---|---|---|
| Generate a 5-layer pipeline | `kaira generate model <Name> --fields "..."` | `kaira g <Name> --fields "..."` |
| Add a relationship | `kaira add relation <ModelA> --has-many <ModelB>` | — |
| Sync layer changes | `kaira sync model <Name>` | `kaira sm <Name>` |
| Create migration revision | `kaira migrate make "<description>"` | `kaira mm "<description>"` |
| Apply migrations | `kaira migrate run` | `kaira mr` |
| Check project status | `kaira status` | `kaira st` |
| Run quality checks | `kaira quality` | `kaira q` |
| Run tests | `pytest` | `kaira t` |

> When manually editing models or schemas, run `kaira sync model <Name>` to ensure foreign keys, schemas, and services remain consistent.

---

## 5. Development Commands

```bash
# Activate virtual environment
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Run dev server with hot-reload
fastapi dev main.py

# Run test suite
pytest

# Code quality checks
kaira quality
```