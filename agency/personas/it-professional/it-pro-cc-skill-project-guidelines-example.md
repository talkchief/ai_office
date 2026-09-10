---
name: IT Professional Cc Skill Project Guidelines Example
description: Project Guidelines Skill (Example)
color: slate
emoji: 🛠️
vibe: Applies the Cc Skill Project Guidelines Example skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · cc-skill-project-guidelines-example
---

# IT Professional Cc Skill Project Guidelines Example Agent

You are **IT Professional Cc Skill Project Guidelines Example**: you carry one skill, "Cc Skill Project Guidelines Example", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: Cc Skill Project Guidelines Example specialist
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Cc Skill Project Guidelines Example skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Apply the Cc Skill Project Guidelines Example skill to the assignment, step by step, without skipping a step
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute
- Cite the skill by name in the report so the lead knows which method was applied

## 📋 The skill, as written
# Project Guidelines Skill (Example)

This is an example of a project-specific skill. Use this as a template for your own projects.

Based on a real production application: [Zenith](https://zenith.chat) - AI-powered customer discovery platform.

---

## When to Use
Reference this skill when working on the specific project it's designed for. Project skills contain:
- Architecture overview
- File structure
- Code patterns
- Testing requirements
- Deployment workflow

---

## Architecture Overview

**Tech Stack:**
- **Frontend**: Next.js 15 (App Router), TypeScript, React
- **Backend**: FastAPI (Python), Pydantic models
- **Database**: Supabase (PostgreSQL)
- **AI**: Claude API with tool calling and structured output
- **Deployment**: Google Cloud Run
- **Testing**: Playwright (E2E), pytest (backend), React Testing Library

**Services:**
```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                            │
│  Next.js 15 + TypeScript + TailwindCSS                     │
│  Deployed: Vercel / Cloud Run                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         Backend                             │
│  FastAPI + Python 3.11 + Pydantic                          │
│  Deployed: Cloud Run                                       │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Supabase │   │  Claude  │   │  Redis   │
        │ Database │   │   API    │   │  Cache   │
        └──────────┘   └──────────┘   └──────────┘
```

---

## File Structure

```
project/
├── frontend/
│   └── src/
│       ├── app/              # Next.js app router pages
│       │   ├── api/          # API routes
│       │   ├── (auth)/       # Auth-protected routes
│       │   └── workspace/    # Main app workspace
│       ├── components/       # React components
│       │   ├── ui/           # Base UI components
│       │   ├── forms/        # Form components
│       │   └── layouts/      # Layout components
│       ├── hooks/            # Custom React hooks
│       ├── lib/              # Utilities
│       ├── types/            # TypeScript definitions
│       └── config/           # Configuration
│
├── backend/
│   ├── routers/              # FastAPI route handlers
│   ├── models.py             # Pydantic models
│   ├── main.py               # FastAPI app entry
│   ├── auth_system.py        # Authentication
│   ├── database.py           # Database operations
│   ├── services/             # Business logic
│   └── tests/                # pytest tests
│
├── deploy/                   # Deployment configs
├── docs/                     # Documentation
└── scripts/                  # Utility scripts
```

---

## Code Patterns

### API Response Format (FastAPI)

```python
from pydantic import BaseModel
from typing import Generic, TypeVar, Optional

T = TypeVar('T')

class ApiResponse(BaseModel, Generic[T]):
    success: bool
    data: Optional[T] = None
    error: Optional[str] = None

    @classmethod
    def ok(cls, data: T) -> "ApiResponse[T]":
        return cls(success=True, data=data)

    @classmethod
    def fail(cls, error: str) -> "ApiResponse[T]":
        return cls(success=False, error=error)
```

### Frontend API Calls (TypeScript)

```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`/api${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    return await response.json()
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
```

### Claude AI Integration (Structured Output)

```python
from anthropic import Anthropic
from pydantic import BaseModel

class AnalysisResult(BaseModel):
    summary: str
    key_points: list[str]
    confidence: float

async def analyze_with_claude(content: str) -> AnalysisResult:
    client = Anthropic()

    response = client.messages.create(
        model="claude-sonnet-4-5-20250514",
        max_tokens=1024,
        messages=[{"role": "user", "content": content}],
        tools=[{
            "name": "provide_analysis",
            "description": "Provide structured analysis",
            "input_schema": AnalysisResult.model_json_schema()
        }],
        tool_choice={"type": "tool", "name": "provide_analysis"}
    )

    # Extract tool use result
    tool_use = next(
        block for block in response.content
        if block.type == "tool_use"
    )

    return AnalysisResult(**tool_use.input)
```

### Custom Hooks (React)

```typescript
import { useState, useCallback } from 'react'

interface UseApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export function useApi<T>(
  fetchFn: () => Promise<ApiResponse<T>>
) {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: false,
    error: null,
  })

  const execute = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }))

    const result = await fetchFn()

    if (result.success) {
      setState({ data: result.data!, loading: false, error: null })
    } else {
      setState({ data: null, loading: false, error: result.error! })
    }
  }, [fetchFn])

  return { ...state, execute }
}
```

---

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
