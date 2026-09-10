# Cloud AI Office

![The office: department rooms around the Program Manager, with the task panel](assets/readme-hero.jpg)

A 3D office run like a company, with you as the CEO. You give work to the **Program Manager**, who hands it to the right **department leads**; leads plan it, hand assignments to their **specialists**, review what comes back against the team's criteria, and only approved work is filed in the **Brain**, the company's shared knowledge. Anything that would send, post, pay or change something outside the office waits for your approval.

It runs on API keys from any provider: Anthropic, OpenAI, OpenRouter (GLM, Kimi and many others) or any OpenAI-compatible endpoint, with a model per role, per team and per person. The agents are built on LangChain Deep Agents.

**Beta.** It works end to end. Expect rough edges.

**License, in plain English:** free for personal and internal use. You may not sell it, resell it, or build a paid product on it. (Formal terms: PolyForm Noncommercial 1.0.0 — see [LICENSE](LICENSE).)

## What you need

- macOS or Linux
- Node.js 22+ — https://nodejs.org (on Rocky/RHEL 9: `dnf module switch-to nodejs:22`)
- git
- An API key from at least one model provider (Anthropic, OpenAI, OpenRouter, or an OpenAI-compatible service)

## Install

```bash
git clone <this repository>
cd agents-office
./setup          # checks Node and git; installs; builds; boots once
npm start        # → http://localhost:4520
```

Without `./setup`: `npm install && node build.mjs && npm start`. Then open **Manage → Models & keys**, paste a key, and choose which model runs each role. Keys stay on the server and are never shown again.

## Moving around

- Scroll to zoom to the cursor, drag to pan, click a room to focus it, click a person to talk to them, double-click the floor or press `0` for the overview.
- **Turn and tilt the office**: drag with the right mouse button (or hold Shift), or `Q` / `E` and the ↺ ↻ buttons. `⌂` straightens the view again.
- `N` cycles morning → day → evening → night to preview the light; by default the office follows your clock (night after 20:00, dark tokens and desk lamps). `D` forces dark, `V` the filming backdrop, `G` the Brain, `B` the board, `X` sends two people to the centre for a chat (offline preview only).

## First five minutes

1. Open http://localhost:4520. The panel on the right shows **Right now**: who is working with whom, live.
2. In the box at the top of the panel, pick a team, or **Let the Program Manager choose**, type what you need and press **Add task**. Under **Assign · due date · more teams · documents** you can name who it is for, set a due date and priority, bring in other teams, and attach documents; they go into the Brain for the team to read.
3. Watch it move: the lead plans, walks over to a specialist, the specialist works, the lead reviews. A lead whose part needs another team hands that part to the Program Manager, who brings the other team in while the first lead carries on. Each card shows the hand-off chain. The result opens as a readable document with the review checks beside it.
4. The **Inbox** (top right, or click the lobby) collects everything that needs you: decisions, approvals for outbound actions, questions, blocked work, overdue work and the daily digest. Turn on desktop alerts there.
5. Click a lead or the Program Manager to talk to them. Type **@** to pick one of the team's tasks, then choose **Ask**, **Correct** or **Note**. A correction reopens the task: the lead reworks it, reviews it again and files a new version. Tick **remember** to keep the correction as a standing rule. Specialists answer questions; corrections go through their lead.
6. Open a finished task and use **Ask for changes** to correct it from there.

## Settings

**Manage** opens a full settings page (the office pauses behind it):

- **Office** — tasks running at once, the time limit per run, when to remind you again, the digest time.
- **Teams & people** — add, rename and remove teams (up to 10; a team is a lead and up to six specialists), each person's job, standing instructions and model, the team's purpose, review criteria, automated checks, tools, pace, standing rules, and tests.
- **Models & keys** — provider keys, then the models you activate from each provider's own list (nothing is built in), and who runs on what (office default, Program Manager, leads, specialists, reviews, chat).
- **Tools & connectors** — MCP servers by URL or local command, sign-in in a new window, which teams may use each, and approval rules per tool.
- **Skills** — reusable methods you give to teams or people. See [SKILLS.md](SKILLS.md).
- **Routines** — tasks the office starts on its own clock, for any team.
- **Reports & KPIs** — throughput, cycle time, review wait, your response time, rework, overdue work, tokens by model.
- **Brain** — upload documents (PDF, Word, text, Markdown, CSV), search everything, edit notes, rebuild the search index.
- **Audit log** — every configuration change, who made it and what changed.

## Routines

A routine is a task the office starts by itself: "every weekday at 8am, triage the inbox and tell me what needs me". Add one under **Manage → Routines** with the schedule at the start of the sentence, or tell a lead in chat. Each run goes through the lead like any other task. A routine that would act outside the office waits for your approval. The clock lives in the server: the page does not have to be open.

## The Brain

The company's shared knowledge: your uploads, the office purpose, finished work (`Agents Office/`) and daily digests (`Digests/`). The Program Manager, leads and specialists search it before and during work, and each result lists the notes it used. Search is full-text (Zvec, with a SQLite fallback). In production the Brain lives in `data/knowledge`; the sample notes in `brain/` are for a fresh install.

## Keys

| Key | Does |
|---|---|
| `1` to `6` | Marketing, Emails, Sales, Operations, Finance, Delivery |
| `B` | The company board: every department, scheduled to done |
| `G` | The Brain graph |
| `C` | Chat with the department lead |
| `X` | Send two agents to meet at the Brain |
| `V` | Full screen view with dimmed lighting |
| `D` | Dark mode. http://localhost:4520/dark opens in it |
| `Esc` | Back |

## The build loop

```bash
npm test              # the test suite (engine, providers, inbox, scheduler, Brain search, …)
npm run check         # build, configuration checks, the test suite, and an API smoke test on throwaway data
CHECK_LIVE=1 npm run check   # … plus one real task through your model provider
```

## Where things live

| Path | What |
|---|---|
| `src/` | The page: `main.js` chrome, rail, chat and hotkeys; `office.js` the task panel, task view and chat context; `settings.js` the settings page; `inbox.js` the inbox; `sse.js` live updates; `rightnow.js` the "Right now" rows and hand-off chains; `brain.js` the Brain view; `mcp.js` connector docks |
| `src/scene/` | The 3D office on React Three Fiber: `index.jsx` mounts it; `office.jsx` the building and rooms; `person.js` the figures; `sim.js` their life and the walk-and-talk hand-overs; `nav.js` walking; `screens.js` wall screens; `overlays.js` pills and speech bubbles; `rig.js` the camera |
| `serve.mjs` · `server/` | The server and its API ([docs/api.md](docs/api.md)) |
| `engine/` | The Program Manager → leads → specialists harness on Deep Agents: prompts, tools, approvals, reviews, live progress |
| `models.mjs` | Providers, models and who runs on what |
| `notifications.mjs` · `threads.mjs` · `sse.mjs` | The inbox, conversations, live events |
| `scheduler.mjs` · `routines.mjs` | Overdue notices, reminders, the daily digest, retention; routines |
| `knowledge.mjs` · `knowledge-index.mjs` · `documents.mjs` | The Brain, its search index, document text extraction |
| `office-store.mjs` · `settings.mjs` · `tool-store.mjs` · `audit.mjs` | Teams and people, office settings, connectors, the audit log |
| `data/` | Everything the office stores (ignored by git): `office.json`, `providers.json`, `settings.json`, `tools.json`, `workflows.sqlite`, `knowledge/` |
| `deploy/` | Running it as a service ([deploy/README.md](deploy/README.md)) |

## Privacy

Your notes and documents are read on the server and sent to your model provider only as context for the task or chat at hand. Connector calls go to that service with the sign-in you gave the office. Provider keys and connector tokens are stored on the server, readable only by the service, and never sent to the browser. Nothing else leaves the machine.
