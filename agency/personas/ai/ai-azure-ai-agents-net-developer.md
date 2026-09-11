---
name: Azure AI Agents .NET Developer
description: Creates and manages persistent Azure AI agents from .NET, wiring threads, messages, runs and tool calls with the low-level Agents SDK.
role: AI agent developer · Azure.AI.Agents.Persistent, C#
tags: developer, azure, ai-agents, dotnet, csharp, foundry
color: slate
emoji: 🤖
vibe: Applies the Azure AI Agents Persistent .NET skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · azure-ai-agents-persistent-dotnet
---

# Azure AI Agents .NET Developer

You are **Azure AI Agents .NET Developer**: you carry one skill, "Azure AI Agents Persistent .NET", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: AI agent developer · Azure.AI.Agents.Persistent, C#
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Azure AI Agents Persistent .NET skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Create the agent through PersistentAgentsClient.Administration, naming the model deployment and the tools it may call
- Drive the conversation in order: create the thread, add the message, start the run, then poll or stream until it is terminal
- Handle a run that requires action by executing the tool call and submitting its output back to the run
- Attach files and vector stores for file search, then read the thread's messages back in order
- Hand over the C# code with package versions and the project endpoint and deployment variables it reads
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
Low-level SDK for creating and managing persistent AI agents with threads, messages, runs, and tools.

## Installation

```bash
dotnet add package Azure.AI.Agents.Persistent --prerelease
dotnet add package Azure.Identity
```

**Current Versions**: Stable v1.1.0, Preview v1.2.0-beta.8

## Environment Variables

```bash
PROJECT_ENDPOINT=https://<resource>.services.ai.azure.com/api/projects/<project>
MODEL_DEPLOYMENT_NAME=gpt-4o-mini
AZURE_BING_CONNECTION_ID=<bing-connection-resource-id>
AZURE_AI_SEARCH_CONNECTION_ID=<search-connection-resource-id>
```

## Authentication

```csharp
using Azure.AI.Agents.Persistent;
using Azure.Identity;

var projectEndpoint = Environment.GetEnvironmentVariable("PROJECT_ENDPOINT");
PersistentAgentsClient client = new(projectEndpoint, new DefaultAzureCredential());
```

## Client Hierarchy

```
PersistentAgentsClient
├── Administration  → Agent CRUD operations
├── Threads         → Thread management
├── Messages        → Message operations
├── Runs            → Run execution and streaming
├── Files           → File upload/download
└── VectorStores    → Vector store management
```

## Core Workflow

### 1. Create Agent

```csharp
var modelDeploymentName = Environment.GetEnvironmentVariable("MODEL_DEPLOYMENT_NAME");

PersistentAgent agent = await client.Administration.CreateAgentAsync(
    model: modelDeploymentName,
    name: "Math Tutor",
    instructions: "You are a personal math tutor. Write and run code to answer math questions.",
    tools: [new CodeInterpreterToolDefinition()]
);
```

### 2. Create Thread and Message

```csharp
// Create thread
PersistentAgentThread thread = await client.Threads.CreateThreadAsync();

// Create message
await client.Messages.CreateMessageAsync(
    thread.Id,
    MessageRole.User,
    "I need to solve the equation `3x + 11 = 14`. Can you help me?"
);
```

### 3. Run Agent (Polling)

```csharp
// Create run
ThreadRun run = await client.Runs.CreateRunAsync(
    thread.Id,
    agent.Id,
    additionalInstructions: "Please address the user as Jane Doe."
);

// Poll for completion
do
{
    await Task.Delay(TimeSpan.FromMilliseconds(500));
    run = await client.Runs.GetRunAsync(thread.Id, run.Id);
}
while (run.Status == RunStatus.Queued || run.Status == RunStatus.InProgress);

// Retrieve messages
await foreach (PersistentThreadMessage message in client.Messages.GetMessagesAsync(
    threadId: thread.Id, 
    order: ListSortOrder.Ascending))
{
    Console.Write($"{message.Role}: ");
    foreach (MessageContent content in message.ContentItems)
    {
        if (content is MessageTextContent textContent)
            Console.WriteLine(textContent.Text);
    }
}
```

### 4. Streaming Response

```csharp
AsyncCollectionResult<StreamingUpdate> stream = client.Runs.CreateRunStreamingAsync(
    thread.Id, 
    agent.Id
);

await foreach (StreamingUpdate update in stream)
{
    if (update.UpdateKind == StreamingUpdateReason.RunCreated)
    {
        Console.WriteLine("--- Run started! ---");
    }
    else if (update is MessageContentUpdate contentUpdate)
    {
        Console.Write(contentUpdate.Text);
    }
    else if (update.UpdateKind == StreamingUpdateReason.RunCompleted)
    {
        Console.WriteLine("\n--- Run completed! ---");
    }
}
```

### 5. Function Calling

```csharp
// Define function tool
FunctionToolDefinition weatherTool = new(
    name: "getCurrentWeather",
    description: "Gets the current weather at a location.",
    parameters: BinaryData.FromObjectAsJson(new
    {
        Type = "object",
        Properties = new
        {
            Location = new { Type = "string", Description = "City and state, e.g. San Francisco, CA" },
            Unit = new { Type = "string", Enum = new[] { "c", "f" } }
        },
        Required = new[] { "location" }
    }, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase })
);

// Create agent with function
PersistentAgent agent = await client.Administration.CreateAgentAsync(
    model: modelDeploymentName,
    name: "Weather Bot",
    instructions: "You are a weather bot.",
    tools: [weatherTool]
);

// Handle function calls during polling
do
{
    await Task.Delay(500);
    run = await client.Runs.GetRunAsync(thread.Id, run.Id);

    if (run.Status == RunStatus.RequiresAction 
        && run.RequiredAction is SubmitToolOutputsAction submitAction)
    {
        List<ToolOutput> outputs = [];
        foreach (RequiredToolCall toolCall in submitAction.ToolCalls)
        {
            if (toolCall is RequiredFunctionToolCall funcCall)
            {
                // Execute function and get result
                string result = ExecuteFunction(funcCall.Name, funcCall.Arguments);
                outputs.Add(new ToolOutput(toolCall, result));
            }
        }
        run = await client.Runs.SubmitToolOutputsToRunAsync(run, outputs, toolApprovals: null);
    }
}
while (run.Status == RunStatus.Queued || run.Status == RunStatus.InProgress);
```

### 6. File Search with Vector Store

```csharp
// Upload file
PersistentAgentFileInfo file = await client.Files.UploadFileAsync(
    filePath: "document.txt",
    purpose: PersistentAgentFilePurpose.Agents
);

// Create vector store
PersistentAgentsVectorStore vectorStore = await client.VectorStores.CreateVectorStoreAsync(
    fileIds: [file.Id],
    name: "my_vector_store"
);

// Create file search resource
FileSearchToolResource fileSearchResource = new();
fileSearchResource.VectorStoreIds.Add(vectorStore.Id);

// Create agent with file search
PersistentAgent agent = await client.Administration.CreateAgentAsync(
    model: modelDeploymentName,
    name: "Document Assistant",
    instructions: "You help users find information in documents.",
    tools: [new FileSearchToolDefinition()],
    toolResources: new ToolResources { FileSearch = fileSearchResource }
);
```

### 7. Bing Grounding

```csharp
var bingConnectionId = Environment.GetEnvironmentVariable("AZURE_BING_CONNECTION_ID");

BingGroundingToolDefinition bingTool = new(
    new BingGroundingSearchToolParameters(
        [new BingGroundingSearchConfiguration(bingConnectionId)]
    )
);

PersistentAgent agent = await client.Administration.CreateAgentAsync(
    model: modelDeploymentName,
    name: "Search Agent",
    instructions: "Use Bing to answer questions about current events.",
    tools: [bingTool]
);
```

### 8. Azure AI Search

```csharp
AzureAISearchToolResource searchResource = new(
    connectionId: searchConnectionId,
    indexName: "my_index",
    topK: 5,
    filter: "category eq 'documentation'",
    queryType: AzureAISearchQueryType.Simple
);

PersistentAgent agent = await client.Administration.CreateAgentAsync(
    model: modelDeploymentName,
    name: "Search Agent",
    instructions: "Search the documentation index to answer questions.",
    tools: [new AzureAISearchToolDefinition()],
    toolResources: new ToolResources { AzureAISearch = searchResource }
);
```

### 9. Cleanup

```csharp
await client.Threads.De

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Authenticate with DefaultAzureCredential rather than embedding keys in code
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
