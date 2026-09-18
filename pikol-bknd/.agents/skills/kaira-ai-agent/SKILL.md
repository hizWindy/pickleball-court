---
name: kaira-ai-agent
description: Use this skill whenever the user asks to add AI capabilities, RAG pipelines, LLM chatbots, agent skills, or multi-agent supervisor workflows to this project.
---

# AI & Multi-Agent Architecture in pikol-bknd

This project supports an integrated, production-grade AI layer built with Kaira CLI. It allows adding vector search, RAG pipelines, and autonomous agents that can call existing domain services as tools.

---

## 1. Initializing the AI Gateway

To set up the multi-provider LLM gateway (`services/ai/gateway.py`) with support for OpenAI, Anthropic, Ollama, and DeepSeek:

```bash
kaira ai init --provider openai
```

---

## 2. Scaffolding a 5-Layer RAG Pipeline

To create a complete vector retrieval pipeline with document ingestion and SSE streaming:

```bash
kaira ai rag <DomainName> --vector-db pgvector
```

### Generated Pipeline:
* `models/<name>.py`: Document chunk model with vector embeddings.
* `repositories/<name>_repository.py`: Cosine similarity search.
* `services/<name>_service.py`: Text chunking and embedding generation.
* `routers/<name>_router.py`: `POST /ingest` and streaming `POST /query` SSE endpoint.

---

## 3. Creating Agent Skills from Existing Services

To expose an existing Kaira domain service (e.g. `OrderService`) as an agent skill/tool:

```bash
kaira ai skill <skill_name> --from-service <ServiceName>
```

### Example:
```bash
kaira ai skill cancel_order --from-service OrderService
```
Kaira uses AST parsing to extract method arguments and generates a Pydantic-typed tool in `services/ai/skills/cancel_order.py`.

---

## 4. Scaffolding Autonomous Agents & Supervisors

* **Create an Agent:**
  ```bash
  kaira ai agent SupportBot --role "Customer Support" --skills cancel_order
  ```
* **Create a Multi-Agent Supervisor:**
  ```bash
  kaira ai graph HelpDesk --subagents BillingBot,TechBot
  ```