---
name: IT Professional Langchain Architecture
description: Master the LangChain framework for building sophisticated LLM applications with agents, chains, memory, and tool integration.
color: slate
emoji: 🛠️
vibe: Applies the Langchain Architecture skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · langchain-architecture
---

# IT Professional Langchain Architecture Agent

You are **IT Professional Langchain Architecture**: you carry one skill, "Langchain Architecture", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: Langchain Architecture specialist
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Langchain Architecture skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Apply the Langchain Architecture skill to the assignment, step by step, without skipping a step
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute
- Cite the skill by name in the report so the lead knows which method was applied

## 📋 The skill, as written
# LangChain Architecture

Master the LangChain framework for building sophisticated LLM applications with agents, chains, memory, and tool integration.

## Do not use this skill when

- The task is unrelated to langchain architecture
- You need a different domain or tool outside this scope

## Instructions

- Clarify goals, constraints, and required inputs.
- Apply relevant best practices and validate outcomes.
- Provide actionable steps and verification.
- If detailed examples are required, open `resources/implementation-playbook.md`.

## Use this skill when

- Building autonomous AI agents with tool access
- Implementing complex multi-step LLM workflows
- Managing conversation memory and state
- Integrating LLMs with external data sources and APIs
- Creating modular, reusable LLM application components
- Implementing document processing pipelines
- Building production-grade LLM applications

## Core Concepts

### 1. Agents
Autonomous systems that use LLMs to decide which actions to take.

**Agent Types:**
- **ReAct**: Reasoning + Acting in interleaved manner
- **OpenAI Functions**: Leverages function calling API
- **Structured Chat**: Handles multi-input tools
- **Conversational**: Optimized for chat interfaces
- **Self-Ask with Search**: Decomposes complex queries

### 2. Chains
Sequences of calls to LLMs or other utilities.

**Chain Types:**
- **LLMChain**: Basic prompt + LLM combination
- **SequentialChain**: Multiple chains in sequence
- **RouterChain**: Routes inputs to specialized chains
- **TransformChain**: Data transformations between steps
- **MapReduceChain**: Parallel processing with aggregation

### 3. Memory
Systems for maintaining context across interactions.

**Memory Types:**
- **ConversationBufferMemory**: Stores all messages
- **ConversationSummaryMemory**: Summarizes older messages
- **ConversationBufferWindowMemory**: Keeps last N messages
- **EntityMemory**: Tracks information about entities
- **VectorStoreMemory**: Semantic similarity retrieval

### 4. Document Processing
Loading, transforming, and storing documents for retrieval.

**Components:**
- **Document Loaders**: Load from various sources
- **Text Splitters**: Chunk documents intelligently
- **Vector Stores**: Store and retrieve embeddings
- **Retrievers**: Fetch relevant documents
- **Indexes**: Organize documents for efficient access

### 5. Callbacks
Hooks for logging, monitoring, and debugging.

**Use Cases:**
- Request/response logging
- Token usage tracking
- Latency monitoring
- Error handling
- Custom metrics collection

## Quick Start

```python
from langchain.agents import AgentType, initialize_agent, load_tools
from langchain.llms import OpenAI
from langchain.memory import ConversationBufferMemory

# Initialize LLM
llm = OpenAI(temperature=0)

# Load tools
tools = load_tools(["serpapi", "llm-math"], llm=llm)

# Add memory
memory = ConversationBufferMemory(memory_key="chat_history")

# Create agent
agent = initialize_agent(
    tools,
    llm,
    agent=AgentType.CONVERSATIONAL_REACT_DESCRIPTION,
    memory=memory,
    verbose=True
)

# Run agent
result = agent.run("What's the weather in SF? Then calculate 25 * 4")
```

## Architecture Patterns

### Pattern 1: RAG with LangChain
```python
from langchain.chains import RetrievalQA
from langchain.document_loaders import TextLoader
from langchain.text_splitter import CharacterTextSplitter
from langchain.vectorstores import Chroma
from langchain.embeddings import OpenAIEmbeddings

# Load and process documents
loader = TextLoader('documents.txt')
documents = loader.load()

text_splitter = CharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
texts = text_splitter.split_documents(documents)

# Create vector store
embeddings = OpenAIEmbeddings()
vectorstore = Chroma.from_documents(texts, embeddings)

# Create retrieval chain
qa_chain = RetrievalQA.from_chain_type(
    llm=llm,
    chain_type="stuff",
    retriever=vectorstore.as_retriever(),
    return_source_documents=True
)

# Query
result = qa_chain({"query": "What is the main topic?"})
```

### Pattern 2: Custom Agent with Tools
```python
from langchain.agents import Tool, AgentExecutor
from langchain.agents.react.base import ReActDocstoreAgent
from langchain.tools import tool

@tool
def search_database(query: str) -> str:
    """Search internal database for information."""
    # Your database search logic
    return f"Results for: {query}"

@tool
def send_email(recipient: str, content: str) -> str:
    """Send an email to specified recipient."""
    # Email sending logic
    return f"Email sent to {recipient}"

tools = [search_database, send_email]

agent = initialize_agent(
    tools,
    llm,
    agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION,
    verbose=True
)
```

### Pattern 3: Multi-Step Chain
```python
from langchain.chains import LLMChain, SequentialChain
from langchain.prompts import PromptTemplate

# Step 1: Extract key information
extract_prompt = PromptTemplate(
    input_variables=["text"],
    template="Extract key entities from: {text}\n\nEntities:"
)
extract_chain = LLMChain(llm=llm, prompt=extract_prompt, output_key="entities")

# Step 2: Analyze entities
analyze_prompt = PromptTemplate(
    input_variables=["entities"],
    template="Analyze these entities: {entities}\n\nAnalysis:"
)
analyze_chain = LLMChain(llm=llm, prompt=analyze_prompt, output_key="analysis")

# Step 3: Generate summary
summary_prompt = PromptTemplate(
    input_variables=["entities", "analysis"],
    template="Summarize:\nEntities: {entities}\nAnalysis: {analysis}\n\nSummary:"
)
summary_chain = LLMChain(llm=llm, prompt=summary_prompt, output_key="summary")

# Combine into sequential chain
overall_chain = SequentialChain(
    chains=[extract_chain, analyze_chain, summary_chain],
    input_variables=["text"],
    output_variables=["entities", "analysis", "summary"],
    verbose=True
)
```

## Memory Management Best Practices

### Choosing the Right Memory Type
```python
# For short conversations (< 10 messages)
from langchain.memory import ConversationBufferMemory
memory = ConversationBufferMemory()

# For long conversations (summarize old messages)
from langchain.memory import ConversationSummaryMemory
memory = ConversationSummaryMemory(llm=llm)

# For sliding window (last N messages)
from langchain.memory import ConversationBufferWindowMemory
memory = ConversationBufferWindowMemory(k=5)

# For entity tracking
from langchain.memory import ConversationEntityMemory
memory = ConversationEntityMemory(llm=llm)

# For semantic retrieval of relevant history
from langchain.memory import VectorStoreRetrieverMemory
memory = VectorStoreRetrieverMemory(retriever=retriever)
```

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
