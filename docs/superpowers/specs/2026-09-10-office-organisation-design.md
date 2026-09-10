# The office as a real company: charters, scoped knowledge, dependable tools

Date: 2026-09-10. Status: approved by the CEO in conversation ("fix everything, production ready").

## Problem

A task to Marketing ("what do you know about Talkchief?") failed because the Marketing research specialist, with no web tool, used a calendar connector's raw HTTP tool as a browser. Two calendar tasks failed on argument validation. A running lead was drawn as idle. Every team charter and every person's standing brief is empty, so prompts carry no purpose. Leads and the Program Manager are told nothing about tools, so nobody can route work to the team that has the right tool.

## Design

### 1. Team charters and personal briefs are never empty
- `office-store.mjs` ships a charter per default department (purpose + working instructions, written as a real company would) in `DEFAULT_TEAMS`, and `office.agents.json` ships a `brief` for all 35 seats.
- Validation: a team must have a non-empty `purpose` and `instructions`; a person must have a non-empty `does` and `brief`. Refused with a plain sentence, nothing applied (existing behaviour of `validate`).
- Migration `fillOrganisation(office)` (in `office-charters.mjs`, run by the office store when it opens an existing file, idempotent): fills empty purpose/instructions from `DEFAULT_TEAMS` by team id, and empty briefs from the shipped roster by agent id; a team or person with no shipped default gets a generic charter/brief derived from its name and `does`. This keeps every existing office valid under the new rule.
- Settings → Teams & people: purpose, instructions, does and brief are `required` with the same wording as the server. Adding a team or person starts with empty fields the CEO must fill; hiring from the Agency fills them from the persona.

### 2. Who knows what (prompts.mjs)
- **Program Manager** gets the org chart: every team's name, lead, purpose, people (name, role, what they do), tools (connectors and web), skills. Rule added: route to the team whose purpose and tools fit; when a lead reports a hand-off for a missing tool or expertise, delegate that part to the team that has it.
- **Lead** gets its own team only: specialists (already), the team's tools by name, the Brain rule (already). Hand-off rule extended: "or a tool your team does not have; you cannot see other teams' tools, the Program Manager can". Tool list says "none" honestly.
- **Specialist** gets its own tools by name and the rule: if the work needs a tool you do not have, say so in your answer and stop; never substitute another tool for it (a calendar tool is not a browser).
- Tool names: `web` → "Web search & fetch"; a connector id is shown as its display name from the tool store (passed in as `toolLabels`), falling back to the id.
- `hand_to_program_manager` description mentions tools as a reason.

### 3. Tools that survive the adapter (engine/tools.mjs)
- `restoreSchema(raw)` rebuilds each MCP tool's input schema from the server's raw `inputSchema` after `@langchain/mcp-adapters` has flattened it: `anyOf`/`oneOf` of constants become `enum` with a type; `[X, null]` becomes X; unions of objects merge; other unions stay `anyOf`; `_meta`/`$schema` are dropped; `type`, `description`, `required`, `items`, `properties` are kept. `ToolHub.load()` fetches raw schemas via the adapter's per-server client and replaces `tool.schema`.
- Reloading connectors no longer kills running tasks: `load()` builds the new client first, then parks the old one in `retired` with a timestamp; `sweep()` closes retired clients older than the run time limit (`settings().runTimeoutMinutes`, default 45). `close()` closes everything.

### 4. The scene shows a working lead (src/office.js)
- A lead run with state `working` marks the lead as doing that task (runs are already sent to the board). Pod counts and the lead line follow.

### 5. Team access defaults
- No code change: the CEO unticks the calendar for teams that do not need it. The Team access page already shows each team's purpose next to the tick box, which is now filled.

## Tests (node:test, tests/)
- `tools.test.mjs`: restoreSchema on Zapier-shaped schemas (enum from consts, boolean from `[boolean,null]`, object merge, `_meta` dropped); hub reload keeps the old client until sweep.
- `office.test.mjs` or `harness.test.mjs`: validate refuses an empty purpose/instructions/does/brief with the expected sentence; migration fills empties and is idempotent.
- `engine.test.mjs`: PM prompt lists every team's tools and people; lead prompt lists only its own team's tools; specialist prompt carries the no-substitution rule.

## Out of scope
- Retrying a tool call that fails with "Not connected" (grace period makes it unnecessary).
- Zapier's `get_dynamic_properties_schema` two-step: the tool descriptions already instruct it; with types restored the model follows them.

### 6. Long-term memory the Program Manager can read while a task runs
- Short-term memory already exists: the SQLite checkpointer keeps each task thread. Long-term memory is added as a LangGraph store (`BaseStore`) backed by the same SQLite file (`office_memory` table, namespace + key + JSON value), mounted through Deep Agents by role (`OfficeMemory.routesFor`): the Program Manager gets `/memories/company/`, a team gets `/memories/team/` with its own page only, everyone gets `/memories/notes/`.
- The office writes `/memories/company/org-chart.md` (teams, purposes, people, tools, skills) and `/memories/company/connectors.md` (what is connected, what each team may use) whenever teams, people, skills or connectors change, and once at boot. The Program Manager's prompt says to read the org chart before delegating and again when a lead reports a hand-off; leads read only their own team's page (`/memories/team/team.md`).
- Agents may write their own notes under `/memories/<agent-id>/`; the company pages are read-only to them.
- Semantic recall over memories reuses the Brain's search index later; not in this change.

### 7. Follow-ups built the same evening
- **Personal tool grants count.** `agentToolIds(team, agent, known)` in `engine/tools.mjs`: a person inherits the team's tools (or only the ones they list when not inheriting) plus any tool granted to them alone, limited to tools the office knows (connector ids and `web`), so the seed roster's placeholder names are ignored. The lead prompt and the Program Manager's org chart say who has what ("INVOICING also has Web search & fetch: delegate work that needs it to them"); the connectors card shows "FINANCE (FINANCIAL ANALYST only)".
- **PDF deliverables.** `engine/documents.mjs`: Markdown rendered to PDF with pdfkit (headings, lists, tables, code, quotes, links, page numbers); the `export_pdf` tool for every specialist and lead; the task detail lists workspace files; `GET /api/tasks/:id/file?path=` streams one; the task page shows a FILES block with download links. The shared FILES prompt names the formats agents can produce and forbids writing binary by hand.
- **Silent model calls fail fast.** `CALL_TIMEOUT_MS` (5 minutes) on both chat clients in `models.mjs`.
- **No phantom worker; busy means busy.** Deep Agents' general-purpose worker is disabled per provider; `activeAgents()` counts only running runs and the roster guard ignores ids that are not people.
- **Scene and board.** A lead whose specialist is working reads as waiting; a submitted desk clears once its lead has acted; the page reloads itself at a calm moment when the roster changes; the board refreshes after the live stream reconnects; team counts follow hand-offs.
- **Agency.** A persona without rules gets a brief derived from its description and method; the picker is a proper panel.

### 8. Documents, decks and artifacts
- `engine/documents.mjs`: Markdown → HTML with a print stylesheet → PDF printed by the Chrome or Edge on the machine through playwright-core (`AO_CHROME` names another binary); a pdfkit renderer is the fallback when no browser exists. The fallback's footer lifts the bottom margin while it writes, because pdfkit otherwise starts a new page for text inside the margin, which produced a blank page after every real one. Page counts come from the PDF page tree.
- Decks: `renderPptx` through pptxgenjs, cover plus one slide per `##` heading, bullets from lists, tables kept, long sections continued on the next slide.
- Tools `export_pdf` and `export_pptx` for every specialist and lead; the shared FILES prompt names the formats and forbids writing binary by hand; a `file_saved` event per export.
- The task page's Artifacts tab lists every workspace file, exported documents first, each with a download link (`GET /api/tasks/:id/file?path=`, paths confined to the workspace).
- Transient provider failures (5xx, 429, overload, dropped connection, timeout) block the task quietly and retry once after 30 seconds (`isTransientProviderError`); key, credit and model-name errors still reach the inbox at once.
- Board: a task counts for a team only when it was sent to it, handed to it, or its lead has run on it (`involves`), so a Program-Manager task no longer lights up every pod; the card names the teams that worked, in order.

### 9. Projects
- `projects.mjs`: `ProjectStore` in `data/projects.json`. A project has a name, a purpose, a charter, owning teams (a hint: the Program Manager may bring in any team), start and target dates, milestones (ticked when reached, the next one is what planning aims at) and a status (active, paused, done, archived; archived takes no new tasks). Validation speaks in sentences.
- The office keeps `Projects/<id>/project.md` in the Brain: purpose, charter, owners, timeline with milestones, files in the folder, and every task of the project with its state and result preview. Rewritten (debounced) on every project change and every task update of that project. Files upload into `Projects/<id>/` through the same document extraction as task documents.
- A task created with `projectId` carries `projectName` and starts with a PROJECT block (purpose, charter, next milestone, page path) in its brief; the Program Manager's prompt says to read the page first and pass the project to every lead. `/memories/company/projects.md` lists open projects with next milestone and open/done task counts.
- API: `GET/POST /api/projects`, `GET /api/projects/:id` (project, its tasks, its files), `PUT /api/projects/:id`, `POST /api/projects/:id/status`, `POST /api/projects/:id/upload`, `GET /api/projects/open` for the task form.
- UI: Settings → Projects (cards, then a page with the charter form, owners, milestones editor, files with upload, tasks with an add form); the task form has a Project picker; a task card shows its project; the Program Manager panel lists open projects.
- Brain note ids now use forward slashes on every platform (`knowledge.list()`, archived copies); this fixed the Brain index tests on Windows.
