---
name: IT Professional Azure Ai Projects Ts
description: High-level SDK for Azure AI Foundry projects with agents, connections, deployments, and evaluations.
color: slate
emoji: 🛠️
vibe: Applies the Azure Ai Projects Ts skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · azure-ai-projects-ts
---

# IT Professional Azure Ai Projects Ts Agent

You are **IT Professional Azure Ai Projects Ts**: you carry one skill, "Azure Ai Projects Ts", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: Azure Ai Projects Ts specialist
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Azure Ai Projects Ts skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Apply the Azure Ai Projects Ts skill to the assignment, step by step, without skipping a step
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute
- Cite the skill by name in the report so the lead knows which method was applied

## 📋 The skill, as written
# Azure AI Projects SDK for TypeScript

High-level SDK for Azure AI Foundry projects with agents, connections, deployments, and evaluations.

## Installation

```bash
npm install @azure/ai-projects @azure/identity
```

For tracing:
```bash
npm install @azure/monitor-opentelemetry @opentelemetry/api
```

## Environment Variables

```bash
AZURE_AI_PROJECT_ENDPOINT=https://<resource>.services.ai.azure.com/api/projects/<project>
MODEL_DEPLOYMENT_NAME=gpt-4o
```

## Authentication

```typescript
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";

const client = new AIProjectClient(
  process.env.AZURE_AI_PROJECT_ENDPOINT!,
  new DefaultAzureCredential()
);
```

## Operation Groups

| Group | Purpose |
|-------|---------|
| `client.agents` | Create and manage AI agents |
| `client.connections` | List connected Azure resources |
| `client.deployments` | List model deployments |
| `client.datasets` | Upload and manage datasets |
| `client.indexes` | Create and manage search indexes |
| `client.evaluators` | Manage evaluation metrics |
| `client.memoryStores` | Manage agent memory |

## Getting OpenAI Client

```typescript
const openAIClient = await client.getOpenAIClient();

// Use for responses
const response = await openAIClient.responses.create({
  model: "gpt-4o",
  input: "What is the capital of France?"
});

// Use for conversations
const conversation = await openAIClient.conversations.create({
  items: [{ type: "message", role: "user", content: "Hello!" }]
});
```

## Agents

### Create Agent

```typescript
const agent = await client.agents.createVersion("my-agent", {
  kind: "prompt",
  model: "gpt-4o",
  instructions: "You are a helpful assistant."
});
```

### Agent with Tools

```typescript
// Code Interpreter
const agent = await client.agents.createVersion("code-agent", {
  kind: "prompt",
  model: "gpt-4o",
  instructions: "You can execute code.",
  tools: [{ type: "code_interpreter", container: { type: "auto" } }]
});

// File Search
const agent = await client.agents.createVersion("search-agent", {
  kind: "prompt",
  model: "gpt-4o",
  tools: [{ type: "file_search", vector_store_ids: [vectorStoreId] }]
});

// Web Search
const agent = await client.agents.createVersion("web-agent", {
  kind: "prompt",
  model: "gpt-4o",
  tools: [{
    type: "web_search_preview",
    user_location: { type: "approximate", country: "US", city: "Seattle" }
  }]
});

// Azure AI Search
const agent = await client.agents.createVersion("aisearch-agent", {
  kind: "prompt",
  model: "gpt-4o",
  tools: [{
    type: "azure_ai_search",
    azure_ai_search: {
      indexes: [{
        project_connection_id: connectionId,
        index_name: "my-index",
        query_type: "simple"
      }]
    }
  }]
});

// Function Tool
const agent = await client.agents.createVersion("func-agent", {
  kind: "prompt",
  model: "gpt-4o",
  tools: [{
    type: "function",
    function: {
      name: "get_weather",
      description: "Get weather for a location",
      strict: true,
      parameters: {
        type: "object",
        properties: { location: { type: "string" } },
        required: ["location"]
      }
    }
  }]
});

// MCP Tool
const agent = await client.agents.createVersion("mcp-agent", {
  kind: "prompt",
  model: "gpt-4o",
  tools: [{
    type: "mcp",
    server_label: "my-mcp",
    server_url: "https://mcp-server.example.com",
    require_approval: "always"
  }]
});
```

### Run Agent

```typescript
const openAIClient = await client.getOpenAIClient();

// Create conversation
const conversation = await openAIClient.conversations.create({
  items: [{ type: "message", role: "user", content: "Hello!" }]
});

// Generate response using agent
const response = await openAIClient.responses.create(
  { conversation: conversation.id },
  { body: { agent: { name: agent.name, type: "agent_reference" } } }
);

// Cleanup
await openAIClient.conversations.delete(conversation.id);
await client.agents.deleteVersion(agent.name, agent.version);
```

## Connections

```typescript
// List all connections
for await (const conn of client.connections.list()) {
  console.log(conn.name, conn.type);
}

// Get connection by name
const conn = await client.connections.get("my-connection");

// Get connection with credentials
const connWithCreds = await client.connections.getWithCredentials("my-connection");

// Get default connection by type
const defaultAzureOpenAI = await client.connections.getDefault("AzureOpenAI", true);
```

## Deployments

```typescript
// List all deployments
for await (const deployment of client.deployments.list()) {
  if (deployment.type === "ModelDeployment") {
    console.log(deployment.name, deployment.modelName);
  }
}

// Filter by publisher
for await (const d of client.deployments.list({ modelPublisher: "OpenAI" })) {
  console.log(d.name);
}

// Get specific deployment
const deployment = await client.deployments.get("gpt-4o");
```

## Datasets

```typescript
// Upload single file
const dataset = await client.datasets.uploadFile(
  "my-dataset",
  "1.0",
  "./data/training.jsonl"
);

// Upload folder
const dataset = await client.datasets.uploadFolder(
  "my-dataset",
  "2.0",
  "./data/documents/"
);

// Get dataset
const ds = await client.datasets.get("my-dataset", "1.0");

// List versions
for await (const version of client.datasets.listVersions("my-dataset")) {
  console.log(version);
}

// Delete
await client.datasets.delete("my-dataset", "1.0");
```

## Indexes

```typescript
import { AzureAISearchIndex } from "@azure/ai-projects";

const indexConfig: AzureAISearchIndex = {
  name: "my-index",
  type: "AzureSearch",
  version: "1",
  indexName: "my-index",
  connectionName: "search-connection"
};

// Create index
const index = await client.indexes.createOrUpdate("my-index", "1", indexConfig);

// List indexes
for await (const idx of client.indexes.list()) {
  console.log(idx.name);
}

// Delete
await client.indexes.delete("my-index", "1");
```

## Key Types

```typescript
import {
  AIProjectClient,
  AIProjectClientOptionalParams,
  Connection,
  ModelDeployment,
  DatasetVersionUnion,
  AzureAISearchIndex
} from "@azure/ai-projects";
```

## Best Practices

1. **Use getOpenAIClient()** - For responses, conversations, files, and vector stores
2. **Version your agents** - Use `createVersion` for reproducible agent definitions
3. **Clean up resources** - Delete agents, conversations when done
4. **Use connections** - Get credentials from project connections, don't hardcode
5. **Filter deployments** - Use `modelPublisher` filter to find specific models

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
