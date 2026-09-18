---
name: kaira-scaffold-model
description: Use this skill whenever the user asks to create, add, or generate a new database entity, model, schema, repository, service, or API endpoint in this project.
---

# Scaffolding Models in pikol-bknd

This project uses **Kaira** to maintain a strict 5-layer clean architecture. Whenever you need to introduce a new data entity or domain model, **DO NOT manually write boilerplate files in models/ or routers/**. Use Kaira CLI to generate the entire synchronized pipeline.

---

## Canonical Command

```bash
kaira generate model <ModelName> --fields "<fieldName>:<type>, <fieldName>:<type>"
```

* **Shortcut:** `kaira g <ModelName> --fields "..."`

### Examples
```bash
# Basic model
kaira generate model Product --fields "title:str, price:float, in_stock:bool"

# Model with optional fields and datetime
kaira generate model Article --fields "title:str, content:str, author_email:Optional[str], published_at:Optional[datetime]"
```

---

## Supported Field Types

- `str`
- `int`
- `float`
- `bool`
- `datetime`
- `Optional[str]`
- `Optional[int]`
- `Optional[float]`
- `Optional[bool]`
- `Optional[datetime]`

---

## What Gets Generated

Kaira will automatically create and wire all 5 layers:
1. `models/<name>.py`: ORM model (SQLAlchemy Async Mapped Table)
2. `repositories/<name>_repository.py`: CRUD data access methods
3. `schemas/<name>_schema.py`: Pydantic v2 schemas (`Base`, `Create`, `Update`, `Response`)
4. `services/<name>_service.py`: Business logic layer
5. `routers/<name>_router.py`: FastAPI endpoints wired with `Depends`

---

## Post-Generation Checklist

1. Verify that `.kaira.json` has recorded the new model.
2. Generate and run the database migration:
   ```bash
   kaira migrate make "add <model_name> table"
   kaira migrate run
   ```
3. Run `pytest` to confirm generated endpoints function cleanly.