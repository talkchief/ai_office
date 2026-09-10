---
name: IT Professional Azure Cosmos Db Py
description: Build production-grade Azure Cosmos DB NoSQL services following clean code, security best practices, and TDD principles.
color: slate
emoji: 🛠️
vibe: Applies the Azure Cosmos Db Py skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · azure-cosmos-db-py
---

# IT Professional Azure Cosmos Db Py Agent

You are **IT Professional Azure Cosmos Db Py**: you carry one skill, "Azure Cosmos Db Py", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: Azure Cosmos Db Py specialist
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Azure Cosmos Db Py skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Apply the Azure Cosmos Db Py skill to the assignment, step by step, without skipping a step
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute
- Cite the skill by name in the report so the lead knows which method was applied

## 📋 The skill, as written
# Cosmos DB Service Implementation

Build production-grade Azure Cosmos DB NoSQL services following clean code, security best practices, and TDD principles.

## Installation

```bash
pip install azure-cosmos azure-identity
```

## Environment Variables

```bash
COSMOS_ENDPOINT=https://<account>.documents.azure.com:443/
COSMOS_DATABASE_NAME=<database-name>
COSMOS_CONTAINER_ID=<container-id>
# For emulator only (not production)
COSMOS_KEY=<emulator-key>
```

## Authentication

**DefaultAzureCredential (preferred)**:
```python
from azure.cosmos import CosmosClient
from azure.identity import DefaultAzureCredential

client = CosmosClient(
    url=os.environ["COSMOS_ENDPOINT"],
    credential=DefaultAzureCredential()
)
```

**Emulator (local development)**:
```python
from azure.cosmos import CosmosClient

client = CosmosClient(
    url="https://localhost:8081",
    credential=os.environ["COSMOS_KEY"],
    connection_verify=False
)
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FastAPI Router                          │
│  - Auth dependencies (get_current_user, get_current_user_required)
│  - HTTP error responses (HTTPException)                         │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                        Service Layer                            │
│  - Business logic and validation                                │
│  - Document ↔ Model conversion                                  │
│  - Graceful degradation when Cosmos unavailable                 │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                     Cosmos DB Client Module                     │
│  - Singleton container initialization                           │
│  - Dual auth: DefaultAzureCredential (Azure) / Key (emulator)   │
│  - Async wrapper via run_in_threadpool                          │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Client Module Setup

Create a singleton Cosmos client with dual authentication:

```python
# db/cosmos.py
from azure.cosmos import CosmosClient
from azure.identity import DefaultAzureCredential
from starlette.concurrency import run_in_threadpool

_cosmos_container = None

def _is_emulator_endpoint(endpoint: str) -> bool:
    return "localhost" in endpoint or "127.0.0.1" in endpoint

async def get_container():
    global _cosmos_container
    if _cosmos_container is None:
        if _is_emulator_endpoint(settings.cosmos_endpoint):
            client = CosmosClient(
                url=settings.cosmos_endpoint,
                credential=settings.cosmos_key,
                connection_verify=False
            )
        else:
            client = CosmosClient(
                url=settings.cosmos_endpoint,
                credential=DefaultAzureCredential()
            )
        db = client.get_database_client(settings.cosmos_database_name)
        _cosmos_container = db.get_container_client(settings.cosmos_container_id)
    return _cosmos_container
```

**Full implementation**: See references/client-setup.md

### 2. Pydantic Model Hierarchy

Use five-tier model pattern for clean separation:

```python
class ProjectBase(BaseModel):           # Shared fields
    name: str = Field(..., min_length=1, max_length=200)

class ProjectCreate(ProjectBase):       # Creation request
    workspace_id: str = Field(..., alias="workspaceId")

class ProjectUpdate(BaseModel):         # Partial updates (all optional)
    name: Optional[str] = Field(None, min_length=1)

class Project(ProjectBase):             # API response
    id: str
    created_at: datetime = Field(..., alias="createdAt")

class ProjectInDB(Project):             # Internal with docType
    doc_type: str = "project"
```

### 3. Service Layer Pattern

```python
class ProjectService:
    def _use_cosmos(self) -> bool:
        return get_container() is not None
    
    async def get_by_id(self, project_id: str, workspace_id: str) -> Project | None:
        if not self._use_cosmos():
            return None
        doc = await get_document(project_id, partition_key=workspace_id)
        if doc is None:
            return None
        return self._doc_to_model(doc)
```

**Full patterns**: See references/service-layer.md

## Core Principles

### Security Requirements

1. **RBAC Authentication**: Use `DefaultAzureCredential` in Azure — never store keys in code
2. **Emulator-Only Keys**: Hardcode the well-known emulator key only for local development
3. **Parameterized Queries**: Always use `@parameter` syntax — never string concatenation
4. **Partition Key Validation**: Validate partition key access matches user authorization

### Clean Code Conventions

1. **Single Responsibility**: Client module handles connection; services handle business logic
2. **Graceful Degradation**: Services return `None`/`[]` when Cosmos unavailable
3. **Consistent Naming**: `_doc_to_model()`, `_model_to_doc()`, `_use_cosmos()`
4. **Type Hints**: Full typing on all public methods
5. **CamelCase Aliases**: Use `Field(alias="camelCase")` for JSON serialization

### TDD Requirements

Write tests BEFORE implementation using these patterns:

```python
@pytest.fixture
def mock_cosmos_container(mocker):
    container = mocker.MagicMock()
    mocker.patch("app.db.cosmos.get_container", return_value=container)
    return container

@pytest.mark.asyncio
async def test_get_project_by_id_returns_project(mock_cosmos_container):
    # Arrange
    mock_cosmos_container.read_item.return_value = {"id": "123", "name": "Test"}
    
    # Act
    result = await project_service.get_by_id("123", "workspace-1")
    
    # Assert
    assert result.id == "123"
    assert result.name == "Test"
```

**Full testing guide**: See references/testing.md

## Reference Files

| File | When to Read |
|------|--------------|
| references/client-setup.md | Setting up Cosmos client with dual auth, SSL config, singleton pattern |
| references/service-layer.md | Implementing full service class with CRUD, conversions, graceful degradation |
| references/testing.md | Writing pytest tests, mocking Cosmos, integration test setup |
| references/partitioning.md | Choosing partition keys, cross-partition queries, move operations |
| references/error-handling.md | Handling CosmosResourceNotFoundError, logging, HTTP error mapping |

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
