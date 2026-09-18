# pikol-bknd ⚡

Secure FastAPI backend application scaffolded with **Kaira**.

## Technology Stack

- **Framework**: [FastAPI](https://fastapi.tiangolo.com/) (installed as `fastapi[standard]`)
- **Database**: postgresql
- **ORM/ODM**: SQLAlchemy Async 2.0 + Alembic
- **Security & Middleware**: Rate limiting (Slowapi), CORS protection, secure headers
- **Logging**: Loguru (structured logs)
- **Authentication**: jwt

## Directory Structure

```text
├── models/             # Database ORM/ODM Models
├── repositories/       # Data-access repository layers
├── schemas/            # Pydantic v2 validation schemas
├── services/           # Business logic service layers
├── routers/            # FastAPI Endpoint Routers
├── auth/               # Authentication handlers & tokens
├── config/             # Environment settings class
├── core/               # Database connection and logger configuration
├── middleware/         # Security and exception-handling middleware
├── tests/              # Pytest unit & integration suites
├── main.py             # App entrypoint
├── requirements.txt    # Pinned dependencies (mirrors pyproject.toml)
├── pyproject.toml      # Project metadata & dependencies
└── Makefile            # Convenience commands
```

> This project is **self-contained** — Kaira is **not** required to run it. A fresh clone only needs Python 3.10+ (and Docker if you don't use SQLite).

## Quick Start

```bash
# 1. Clone and enter
git clone <your-repo-url> && cd pikol-bknd

# 2. Environment variables
cp .env.example .env
# 3. Start the database (Docker)
docker compose up -d db
# 4. Install dependencies (into a virtual environment)
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# 5. Apply database migrations
alembic upgrade head
# 6. Run the server (dev mode, hot-reload)
fastapi dev main.py
```

Interactive API docs: **http://localhost:8000/docs**

### One-liner with Make

If you have `make` installed:

```bash
make install    # create .venv + install deps
make db         # start the databasemake migrate    # apply migrations
make dev        # run with hot-reload
```

## Detailed Setup

### 1. Environment Variables

Copy the example file and adjust values (especially `DATABASE_URL` and `JWT_SECRET_KEY`):

```bash
cp .env.example .env
```
### 2. Install Dependencies

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt  # or: pip install -e .
```

### 3. Database
Start the database with Docker (recommended, no local install needed):

```bash
docker compose up -d db
```

Or point `DATABASE_URL` in `.env` at your own postgresql instance.
### 4. Migrations

```bash
alembic revision --autogenerate -m "initial schema"   # create a migration
alembic upgrade head                                   # apply migrations
```
### 5. Run the Server

```bash
fastapi dev main.py    # development (hot-reload)
fastapi run main.py    # production
```

## Running Tests

```bash
pytest
```