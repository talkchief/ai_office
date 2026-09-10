---
name: IT Professional Hosted Agents
description: Build background agents in sandboxed environments. Use for hosted coding agents, sandboxed VMs, Modal sandboxes, and remote coding environments.
color: slate
emoji: 🛠️
vibe: Applies the Hosted Agents skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · hosted-agents
---

# IT Professional Hosted Agents Agent

You are **IT Professional Hosted Agents**: you carry one skill, "Hosted Agents", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: Hosted Agents specialist
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Hosted Agents skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Apply the Hosted Agents skill to the assignment, step by step, without skipping a step
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute
- Cite the skill by name in the report so the lead knows which method was applied

## 📋 The skill, as written
# Hosted Agent Infrastructure

Hosted agents run in remote sandboxed environments rather than on local machines. When designed well, they provide unlimited concurrency, consistent execution environments, and multiplayer collaboration. The critical insight is that session speed should be limited only by model provider time-to-first-token, with all infrastructure setup completed before the user starts their session.

## When to Use
Activate this skill when:
- Building background coding agents that run independently of user devices
- Designing sandboxed execution environments for agent workloads
- Implementing multiplayer agent sessions with shared state
- Creating multi-client agent interfaces (Slack, Web, Chrome extensions)
- Scaling agent infrastructure beyond local machine constraints
- Building systems where agents spawn sub-agents for parallel work

## Core Concepts

Hosted agents address the fundamental limitation of local agent execution: resource contention, environment inconsistency, and single-user constraints. By moving agent execution to remote sandboxed environments, teams gain unlimited concurrency, reproducible environments, and collaborative workflows.

The architecture consists of three layers: sandbox infrastructure for isolated execution, API layer for state management and client coordination, and client interfaces for user interaction across platforms. Each layer has specific design requirements that enable the system to scale.

## Detailed Topics

### Sandbox Infrastructure

**The Core Challenge**
Spinning up full development environments quickly is the primary technical challenge. Users expect near-instant session starts, but development environments require cloning repositories, installing dependencies, and running build steps.

**Image Registry Pattern**
Pre-build environment images on a regular cadence (every 30 minutes works well). Each image contains:
- Cloned repository at a known commit
- All runtime dependencies installed
- Initial setup and build commands completed
- Cached files from running app and test suite once

When starting a session, spin up a sandbox from the most recent image. The repository is at most 30 minutes out of date, making synchronization with the latest code much faster.

**Snapshot and Restore**
Take filesystem snapshots at key points:
- After initial image build (base snapshot)
- When agent finishes making changes (session snapshot)
- Before sandbox exit for potential follow-up

This enables instant restoration for follow-up prompts without re-running setup.

**Git Configuration for Background Agents**
Since git operations are not tied to a specific user during image builds:
- Generate GitHub app installation tokens for repository access during clone
- Update git config's `user.name` and `user.email` when committing and pushing changes
- Use the prompting user's identity for commits, not the app identity

**Warm Pool Strategy**
Maintain a pool of pre-warmed sandboxes for high-volume repositories:
- Sandboxes are ready before users start sessions
- Expire and recreate pool entries as new image builds complete
- Start warming sandbox as soon as user begins typing (predictive warm-up)

### Agent Framework Selection

**Server-First Architecture**
Choose an agent framework structured as a server first, with TUI and desktop apps as clients. This enables:
- Multiple custom clients without duplicating agent logic
- Consistent behavior across all interaction surfaces
- Plugin systems for extending functionality
- Event-driven architectures for real-time updates

**Code as Source of Truth**
Select frameworks where the agent can read its own source code to understand behavior. This is underrated in AI development: having the code as source of truth prevents hallucination about the agent's own capabilities.

**Plugin System Requirements**
The framework should support plugins that:
- Listen to tool execution events (e.g., `tool.execute.before`)
- Block or modify tool calls conditionally
- Inject context or state at runtime

### Speed Optimizations

**Predictive Warm-Up**
Start warming the sandbox as soon as a user begins typing their prompt:
- Clone latest changes in parallel with user typing
- Run initial setup before user hits enter
- For fast spin-up, sandbox can be ready before user finishes typing

**Parallel File Reading**
Allow the agent to start reading files immediately, even if sync from latest base branch is not complete:
- In large repositories, incoming prompts rarely modify recently-changed files
- Agent can research immediately without waiting for git sync
- Block file edits (not reads) until synchronization completes

**Maximize Build-Time Work**
Move everything possible to the image build step:
- Full dependency installation
- Database schema setup
- Initial app and test suite runs (populates caches)
- Build-time duration is invisible to users

### Self-Spawning Agents

**Agent-Spawned Sessions**
Create tools that allow agents to spawn new sessions:
- Research tasks across different repositories
- Parallel subtask execution for large changes
- Multiple smaller PRs from one major task

Frontier models are capable of containing themselves. The tools should:
- Start a new session with specified parameters
- Read status of any session (check-in capability)
- Continue main work while sub-sessions run in parallel

**Prompt Engineering for Self-Spawning**
Engineer prompts to guide when agents spawn sub-sessions:
- Research tasks that require cross-repository exploration
- Breaking monolithic changes into smaller PRs
- Parallel exploration of different approaches

### API Layer

**Per-Session State Isolation**
Each session requires its own isolated state storage:
- Dedicated database per session (SQLite per session works well)
- No session can impact another's performance
- Handles hundreds of concurrent sessions

**Real-Time Streaming**
Agent work involves high-frequency updates:
- Token streaming from model providers
- Tool execution status updates
- File change notifications

WebSocket connections with hibernation APIs reduce compute costs during idle periods while maintaining open connections.

**Synchronization Across Clients**
Build a single state system that synchronizes across:
- Chat interfaces
- Slack bots
- Chrome extensions
- Web interfaces
- VS Code instances

All changes sync to the session state, enabling seamless client switching.

### Multiplayer Support

**Why Multiplayer Matters**
Multiplayer enables:
- Teaching non-engineers to use AI effectively
- Live QA sessions with multiple team members
- Real-time PR review with immediate changes
- Collaborative debugging sessions

**Implementation Requirements**
- Data model must not tie sessions to single authors
- Pass authorship info to each prompt
- Attribute code changes to the prompting user
- Share sessio

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
