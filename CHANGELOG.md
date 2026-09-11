# Changelog

## Unreleased — the CEO-run office (branch 001-ceo-run-office)

- **A Program Manager runs the work.** Every task goes to the Program Manager, who hands it to one or more department leads; leads hand assignments to their specialists and review the result against the team's criteria before anything is filed. Built on LangChain Deep Agents. The PM can choose the teams itself.
- **The Agency.** 2,155 open-source specialist personas (MIT) in 24 divisions ship with the office, each with a real job title, a one-line description, search tags and standing instructions written from its own method; search ranks by job, so "developer" lists developers first. Every method carries the skill's own guides inline, so nobody is sent looking for a file the office does not have, and the 198 personas whose catalogue text was never a method (a list of other skills to invoke, a table of contents, a marketing page) carry one written for the office instead, and say so. A skill may now be 24,000 characters rather than 10,000: a method is read in full in its person's prompt, and the old limit cut 1,103 of them off mid-procedure. Hire one onto a team from Settings (they carry the same initials avatar as everyone on a team), or take just its method as a skill.
- **The Program Manager plans and reads skills.** Every task starts with a plan (Deep Agents' task list, shown on the task page; a delegation before the plan is refused); the Program Manager reads project-management skills on demand, including the office's running-a-task and cross-team-handoff methods.
- **Tablets and phones.** The work panel becomes a bottom sheet with a handle, the chat fills the width, settings stack in one column, and two fingers pinch to zoom the office.
- **Cross-team hand-offs.** A lead whose assignment needs another team's expertise hands that part to the Program Manager and keeps working on its own part; the task cannot close until the other team has taken it and its lead has approved.
- **Any model provider.** Anthropic, OpenAI, OpenRouter (GLM, Kimi and others) or any OpenAI-compatible endpoint, on API keys. Nothing is built in: save a key, activate models from the provider's own list, then choose a model per role (office default, Program Manager, leads, specialists, reviews, chat), per team and per person. Keys stay on the server. The Claude Code login is no longer used.
- **Real states, real waiting.** "Waiting for the lead's review" is a state the lead is actually told about. A task that needs you says so, reminds you again after an hour, and clears when you act. Results are marked seen when you open them.
- **You approve outbound actions.** Anything that sends, posts, pays, deletes or changes something outside the office waits for your approval, then runs exactly once. Per team, you can also ask to approve completion.
- **The Vault, databases and servers.** Keys, database passwords and SSH credentials are stored once under Settings → Vault and used by agents through the office, never seen. `api_get` reads from an outside service; `db_list`, `db_schema` and `db_query` read a Postgres or MySQL database (one statement, no comments, LIMIT 200 added, 200 rows and 100 KB at most); `db_write` changes data on a connection you marked writable and `ssh_run` runs one command on an SSH target, both after your approval and both refused outright for DROP, TRUNCATE, `rm -rf /` and their kind. Drivers (`pg`, `mysql2`, `ssh2`) are optional.
- **Corrections through the lead.** Ask, correct or add a note on any task. A correction reopens it, gets a fresh review and files version 2. "Remember this" keeps it as a standing rule in your own words.
- **An inbox.** Decisions, questions, blocked work, overdue work and a daily digest, with desktop alerts when the page is in the background. Live updates over a server event stream.
- **The Brain is searchable.** Upload PDF, Word, text, Markdown or CSV into folders. Agents search it with full-text search (Zvec, with a SQLite fallback) and cite the notes they used.
- **Company processes.** Due dates and assignees, overdue notices, routines for every team, an audit log of every configuration change, and KPIs (throughput, cycle time, review wait, your response time, rework, tokens by model).
- **Retention.** Scratch workspaces and resumable checkpoints of tasks finished more than 30 days ago are cleared daily; records, results and history stay.
- **Removed.** Demo mode, team budgets, the Claude CLI execution path, and the three-department limit on routines.
- `npm run check` builds, validates the configuration, runs the whole test suite and smoke-tests the API on throwaway data. Browser checks move with the interface rebuild.
## 3.7.0-beta.1 — 10 Sep 2026

- **The office is a building now, on React Three Fiber.** One floor plate; a room per department with a carpet in the team colour, low partition walls, glass on the outer walls and one door facing the centre; corridors from every door to the Program Manager's glass office in the middle; a lobby, a kitchen, a meeting room and a garden in the corners. Any number of teams: a corner is used only when no room sits on it. The scene code lives in `src/scene/` (`office.jsx`, `person.js`, `sim.js`, `nav.js`, `screens.js`, `daylight.js`, `overlays.js`, `rig.js`); `src/builders.js` is gone. The page (`src/main.js`) reaches the scene through one handle, so the panel, rail and checks did not change.
- **People with a soul.** New figures (neck, collar, hands, shoes, eyes, three hair styles; leads in a blazer with the team tie and the gold pin). They breathe, glance at the screen, stretch now and then, lean in and tap when working; they look up at whoever walks past. When free they chat with a neighbour in speech bubbles, walk to the kitchen for a coffee (a mug in hand, a word with whoever is there), and a lead calls two or three of the team into the meeting room where they sit round the table and talk. A lead who is verifying walks to the worker's desk and stands beside it; the Program Manager walks the corridors to whichever team needs coordinating, leaving a dotted trail. Click anyone and they push back from the desk, stand and wave with a ring on the floor. Everyone walks through doors and corridors, never through a wall (A* on the floor grid).
- **Wall screens.** Every room has a board on its back wall — the team, who is working, a throughput line, the live list. The lobby board shows the office clock and what is happening right now; the kitchen and the meeting room carry a market screen (candles and a ticker tape; a demo feed).
- **Day and night follow the clock.** Morning, day, evening and night change the sky, the sun, the screens' glow and, after 20:00, the dark tokens with desk lamps over busy desks and ceiling lights over the corridors. `N` previews the phases; `D` still forces dark; `#phase=night` for screenshots.
- **Free 360° view.** Drag with the right mouse button (or Shift) to turn and tilt the office; `Q` / `E` and the ↺ ↻ buttons turn it in 45° steps; `⌂` straightens it.
- **The chrome, as designed.** Pod cards read *N of M working*, the state and what the lead is doing, and never cover another team's card. Desk pills carry the state tag, a line of context and a real progress bar; the Program Manager's pill shows its state and where it is heading. The Brain is a button in the top bar. The Task Status panel opens with **Right now** (who is working with whom on what, live from the floor), then **Your call** with APPROVE / REQUEST CHANGES and RETRY / FIX & RETRY inline and the hand-off chain on every card, **Ready to read**, In progress, Ideas, Closed; a quiet state with three things to try, a reconnecting banner. The agent rail shows the current step, who is sitting with them, the live draft and where the step sits in its task. The result dialog is a document beside WHO · CHECKS · LEAD'S NOTE, with the decision at the bottom.
- Node 22 is the prerequisite (`setup`, `package.json`, README). React 19, @react-three/fiber 9 and zustand join the dev dependencies; the built file is ~1.8 MB. `scripts/screenshots.mjs` takes four headless screenshots of the built office.

## 3.6.1-beta.1 — 9 Sep 2026

- **A bigger task box.** The bar is two rows now: the department and the text on top, the model menu, REPEAT and ADD underneath, so the text runs the width of the panel. The box grows as you type, up to six lines, then scrolls. Enter adds; Shift+Enter is a new line.
- **Effort, by name.** An EFFORT menu beside the model: AUTO, Low, Medium, High, Extra high, Max, the levels Claude Code uses. AUTO is the model's own (Opus runs at high). Set it on the task, the routine, the agent (`effort` in the roster) or the office (`effort` in the config), same precedence as the model; every card shows it beside the model name and the note records `effort:`.
- **The big editor.** The ⤢ button inside the box (or ⌘⇧E) opens the same task in a large window with room for a whole brief. It shows the department and the same hint line, ⌘↵ adds, Esc closes, and whatever you type there is in the bar when you close it.

## 3.6.0-beta.1 — 9 Sep 2026

- **Three models, by name.** Sonnet, Opus, Fable. Sonnet is the default for everything, including the routing call. A menu beside REPEAT sets the model for the task you are typing or the routine you are setting; agents take a `model` in the roster; the office default is `model` in the config. The task beats the routine beats the agent beats the office, and every card says which ran and where it was set. Opus runs at effort high; nobody sees an effort setting. Until now every run inherited the login's default model.
- **The usage gauge.** The top bar shows your Claude plan the way Claude Code's usage screen does: session and week, bar and percentage, reset times on hover, amber past 75 and red past 90. Read with the login token Claude Code keeps on this machine, sent only to Anthropic's usage endpoint, never stored. When that endpoint does not answer, the office's own count for the current five-hour window shows instead. No dollars anywhere. A live office shows Claude alone in RUNS HEADLESS ON.
- Three checks: the model table and precedence, the gauge parser and window count, and (live) a task set to Opus running on Opus.

## 3.5.0-beta.1 — 9 Sep 2026

- **Routines: the office runs on its own clock.** A task the office does by itself on a timetable — every weekday at 08:00, every Monday, every hour. Emails, Accounting and Sales in this release; the other departments say "later release" if you try.
- **Three ways to set one.** Type it in the bar with the time in the sentence ("every weekday at 8am, triage the inbox…") and the hint reads the schedule back before you press Add, or press REPEAT and pick a cadence and a time; tell a department lead in chat ("routines", "pause …", "run … now", "delete …" work too); or ask Claude Code, which writes `<brain>/Agents Office/routines.json` (`CLAUDE.md` says how).
- **Where they show.** A SCHEDULED chip in the Task Status panel with a countdown and RUN NOW / PAUSE / DELETE on every routine, a next-up line under the chips, a SCHEDULED column on the company board, a clock chip on the agent's name pill and a routines strip at the top of their chat.
- **The clock lives in the server.** `npm start` fires routines and runs them whether or not the page is open; the page polls and shows the card move. A run missed while the machine slept is caught up once when it comes back, marked LATE.
- **"Needs my OK" is real.** A routine that would send, pay or change anything prepares everything and waits in WAITING ON APPROVAL — the draft in the chat, the agent standing and waving. APPROVE and the agent does the outbound step with its tools; REJECT, say what should change, and it comes back reworked (and the correction is remembered). Read-only routines go straight to DONE. Per-routine switch.
- A live office no longer invents approvals: the theatre asks that used to make a random agent stand and wave are demo-only now, so WAITING ON APPROVAL means a real draft. Real work never waits behind theatre either: a task or routine of yours starts the moment it lands, and the demo job that desk was on is finished.
- Quieter at rest. A live office shows only real reads and writes on the Brain (no theatre glints, no six-second pulse), and the connector loom in the overview runs at about half the ink and half the crawl. Inside a department nothing changed.
- Seven more connector logos: Slack, Google Calendar, Google Drive, Webflow, Playwright, Higgsfield, TerriTool. Anything else still gets an initials tile.
- Routine notes carry `routine:` (and `approved:`) in their front matter. `npm run check` gains six checks: the schedule parser, refusals, the clock and catch-up, the demo bar flow, the API, and (live) a two-minute routine firing end to end.

## 3.4.0-beta.1 — 7 Sep 2026

- Every department now has a lead. Marketing Lead and Operations Lead join at the head of their pods (35 agents). Each runs their team, owns the department's set-up interview, and is where a task lands when Claude cannot pick a specialist.

## 3.3.0-beta.2 — 7 Sep 2026

- The built office page moved from the repo root to `dist/command-centre-v2.html`. Same file, same double-click demo, cleaner repo page. `build.mjs`, `npm start` and the checks all point there.

## 3.3.0-beta.1 — 7 Sep 2026

- **The lead interviews you.** Say "set up" to a department lead. Five questions, one at a time; then it writes a brief for each agent on its team and a skill for the job you described, into your brain, and tells you what it wrote and one task to try. "skip", "done", "cancel". A lead whose department has nothing of yours yet offers this in its greeting.
- **They learn from your corrections.** Every `revise: …` is recorded in `<brain>/Agents Office/feedback/<agent>.md`; Claude sorts it into a one-off or a standing rule, and standing rules go into that agent's prompt from then on. Plain Markdown, yours to edit. `/api/lessons` shows them.
- Roster, skills and lessons are re-read before every task and chat, so a brief no longer needs a restart.
- `/api/health` carries which departments are set up; the boot line says so too.

## 3.2.0-beta.1 — 7 Sep 2026

- **Skills: teach an agent how a kind of work is done.** A folder in your brain, `<brain>/Agents Office/skills/<name>/`, with a `SKILL.md` (when it applies, the steps, the shape, the rules) and the template or example beside it, bound to agents or departments in its front matter. Read in full before every task and chat turn for those agents; the deliverable names the skill it followed and the saved note records it. Re-read from disk on every task, so no restart. Three examples ship in `skills/`. Guide: `SKILLS.md`.
- **Briefs.** A `brief` field on any agent in the roster: standing instructions, up to 2,000 characters, read before every task and chat turn.
- **The roster can live in the brain.** `<brain>/Agents Office/agents.json` is read between the shipped roster and the local file.
- The router sees each agent's skills, so a task that names a kind of work lands on the agent who owns that skill.
- `CLAUDE.md` tells Claude Code how to turn an SOP, a template or a good example into a skill and where to write it. `npm run check` validates skills; `/api/skills` lists what is loaded.
- The shipped roster no longer names anyone: "the owner" throughout.

## 3.1.0-beta.3 — 7 Sep 2026

- One HTML file. The separate dark build is gone; `D` and http://localhost:4520/dark open the same file in dark mode.

## 3.1.0-beta.2 — 7 Sep 2026

- The Brain graph header names your business (it was hard-coded to one company).

## 3.1.0-beta.1 — 7 Sep 2026

- **Connectors are real.** The top bar shows the MCP servers your Claude Code is connected to (`claude mcp list`), not a demo list. Servers that need authentication show grey with the reason on hover and are not wired to any pod. Unknown servers get an initials tile. Nothing connected? The bar says so.
- **Agents use tools.** While they work, agents can call those same connected servers, plus web search (`tools.web`). Bash, file tools and sub-agents stay off. Standing rule: read freely; send, post, pay, delete or change data outside the machine only when the task explicitly asks for that exact action. A deliverable says which tools it used, the note records them, and the logos pulse with the real call.
- **The roster is yours.** `office.agents.json` holds the 33 agents: name, role, what they do, their tools. Override in `office.agents.local.json` (ignored by git). Departments, leads and seats stay fixed. A `CLAUDE.md` in the repo means you can open Claude Code in the folder and say what you want changed.
- `office.config.json` grew `mcp.allow` / `mcp.deny` / `mcp.departments` and `tools.web`; `timeout` (seconds) for long tool runs.
- Live chat now opens with the agent's real job description instead of the demo greeting and sample file.
- `npm run check` validates the roster and the connector endpoint.

## 3.0.0-beta.4 — 6 Sep 2026

- Dark mode: press D, add `#dark=1`, open `command-centre-v2-dark.html`, or visit http://localhost:4520/dark. The scene relights, pods and walkways re-tint, the Brain and wires swap ink.

## 3.0.0-beta.3 — 6 Sep 2026

- No more "demo" label: the panel shows LIVE · CLAUDE when the server is connected and nothing otherwise.

## 3.0.0-beta.2 — 6 Sep 2026

- The Brain strip is gone from the task panel. Open the Brain with G, by clicking the pod, or by its tag.

## 3.0.0-beta.1 — 6 Sep 2026

Agents Office v3 (Beta): the V3 office as a real, installable app.

- Six departments, 33 agents, each with a role, a voice and a task pool.
- Task Status panel with a command bar: type a task, pick the department, the office routes it to the right agent through Claude and the agent produces the deliverable, saved as a note in your brain folder.
- The Brain is your own folder of Markdown notes with `[[wiki links]]`, drawn as a graph over the centre pod, rebuilt live as agents write. `G` opens the full graph with search and a note preview.
- Chat with any agent: real conversation in that agent's persona, grounded in your notes. `revise: …` reworks the last deliverable.
- Runs on your existing Claude Code login, or on an API key if you set one. Nothing leaves your machine except the calls to Claude.
- `npm run check` — the build loop: build, offline smoke, server smoke; `npm run check:live` adds one real task and one chat turn.


## 0.1.0 — 7 Aug 2026

First public release: daemon-based office with inboxes, approvals and an outbox.
