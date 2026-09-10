# Agents Office — for Claude Code

You are in the Agents Office repo. The office is a company the owner runs as CEO. Every task goes to the **Program Manager**, who hands it to one or more **department leads**; leads hand assignments to their **specialists**, review the result against the team's criteria, and only approved work is filed in the Brain. It runs on API keys from any provider (Anthropic, OpenAI, OpenRouter, any OpenAI-compatible endpoint), with a model per role, team and person.

The owner most often asks you to change **who is on a team and what they do**, to teach **how a kind of work is done** (a skill), to put something **on the timetable** (a routine), or to change **which connectors a team may use**. Do those through the office's settings or its API, as described below. Do not change `src/`, `engine/`, `server/` or the build for those requests.

## Where the configuration lives

All in the data folder (`data/`, or `AO_DATA`). The server owns these files; do not edit them by hand while it runs.

| File | Holds | Change it in |
|---|---|---|
| `office.json` | Teams, people, skills, standing rules | Settings → Teams & people, Settings → Skills, or `PUT /api/office` |
| `providers.json` (0600) | Provider keys, models, who runs on what | Settings → Models & keys, or `PUT /api/providers` |
| `settings.json` | Tasks at once, time limit, reminder window, digest time, approval rules | Settings → Office, or `PUT /api/settings` |
| `tools.json` (0600) | Connectors (MCP servers) and their sign-ins | Settings → Tools & connectors |
| `workflows.sqlite` | Tasks, threads, inbox, audit log, checkpoints | Never by hand |

Every change through the API is validated (a bad edit is refused with a sentence, nothing is applied) and recorded in the audit log. **Never print, copy or commit provider keys or connector tokens.** Keys can also come from the environment: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`.

## Changing teams and people

For a running office, read `GET /api/office`, change what the owner asked for, and send the whole object back with `PUT /api/office`. A person has `id, department, name, role, does, brief, model, effort, tools, inheritTools, skills, rules`; a team has `id, name, lead, purpose, instructions, criteria, guardrails, checks, tools, skills, models {lead, specialist, review}, maxParallelRuns (1–4), maxReworkRounds (0–5), completionApproval, rules, tests`.

- `does` is the person's job description, read before every assignment. `brief` is the owner's standing instructions to that person (up to 2,000 characters). Anything longer, or with steps and a template, is a skill.
- `model` is a model id from Settings → Models & keys, or empty for the team's, then the role's default.
- `rules` are the owner's standing rules in their own words. The office adds them when the owner ticks "remember" on a correction. Only remove one when the owner asks.
- Teams can be added, renamed and removed (up to 12 teams, 12 people each; a team keeps a lead and at least one specialist). A team with unfinished work cannot be removed.

**First start only:** a brand-new office seeds its people from `office.agents.json` → `<brain>/Agents Office/agents.json` → `office.agents.local.json` (later wins), 35 seats in six departments. After the first start these files are not read again, so edits to them do nothing for a running office.

## Teaching how a task is done (skills)

When the owner says "this is how we do X", shares an SOP, a template or an example they liked, or asks why results are generic, the answer is a **skill**: a named method with steps, the shape of the result and rules. Create it in Settings → Skills (or add it to `skills` in `office.json` through `PUT /api/office`), then give it to a team or a person. Tasks keep the skill version they started with.

Decide brief or skill first: a paragraph with no steps and no template is a `brief`; steps, a shape, rules or a document to copy make a skill. Before writing one you need the trigger, the source material, the shape of the finished thing and the rules. If one is missing, ask one question for it; never invent the owner's process. Long reference material belongs in the Brain as ordinary notes; the skill names them. Full writing guide: `SKILLS.md`.

Skill folders in `<brain>/Agents Office/skills/` are imported once, when an older office is upgraded.

## The Brain

The company's shared knowledge, in the folder named by `brain` in `office.config(.local).json` (default `./brain`, or `AO_BRAIN`). The Program Manager, leads and specialists search it before and during work and cite the notes they used. Owners upload documents (PDF, Word, text, Markdown, CSV; 25 MB each) into folders such as Company, Projects, Departments. Uploading a file with the same name replaces it and archives the old copy. Finished tasks land in `Agents Office/`, digests in `Digests/`. The search index lives in `data/knowledge-index/`; Settings → Brain can rebuild it.

## Routines: tasks on the office's own clock

"Every Monday …", "each morning …", "automatically at …" is a **routine**: a task the office starts by itself and runs through the team lead like any other. **Every team can have routines.** Create one in Settings → Routines, with `POST /api/routines` (`{ dept, agent, text, needsOk }`, where `text` starts with the schedule), or in `<brain>/Agents Office/routines.json`:

```json
{ "id": "overdue-reminders", "dept": "fin", "agent": "invo",
  "title": "List the overdue invoices and draft the reminders",
  "text": "List the overdue invoices and draft the reminders.",
  "when": { "kind": "weekly", "days": [1], "at": "09:00" },
  "needsOk": true, "paused": false }
```

- `dept` is a team id; `agent` a person in that team (default: the lead). Say which one you chose.
- `when`: `{"kind":"daily","at":"HH:MM"}` · `{"kind":"weekdays","at":"HH:MM"}` · `{"kind":"weekly","days":[1,4],"at":"HH:MM"}` (0 = Sunday) · `{"kind":"hourly","every":1,"from":"09:00","to":"17:00","weekdaysOnly":true}`. Local 24-hour time.
- `needsOk` (default true): the owner approves before the result is closed. Actions that send, post, pay or change things outside the office always wait for the owner regardless.

The server re-reads the file every 20 seconds. Run state lives in `data/routines.json`, never in the Brain.

## Connectors and approvals

Connectors are MCP servers the office connects to itself (Settings → Tools & connectors): add by URL or local command, sign in with OAuth in a new window, then give teams access. A person can use a smaller set than the team. Connectors found in this machine's Claude Code can be imported, then signed in again; the office does not use the Claude Code login.

Any tool that sends, posts, pays, deletes or changes something outside the office pauses for the owner's approval and runs once after it. The office decides from the tool's description and name; Settings → Tools & connectors → Approval rules overrides that per tool. Agents never get a shell or the server's files; each task has its own scratch workspace, and the Brain is read-only to them.

## Everything else

- `npm run check` is the loop: build, configuration checks, the whole test suite, and an API smoke test on throwaway data. Run it after any code change and fix what is red. `CHECK_LIVE=1 npm run check` also runs one real task through the configured provider.
- `npm test` runs the test suite alone (Node 22).
- `README.md` says what the product does. Keep it true to the code.
- Release: `node scripts/release.mjs --push` (owner only).
