// Every /api route. `ctx` carries the stores and the engine built in serve.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { workspaceFile, mimeOf } from '../engine/documents.mjs';
import { VAULT_KINDS } from '../vault.mjs';
import { readJsonBody as body } from '../http-body.mjs';
import { listShape, detailShape } from './shape.mjs';
import { httpError } from './routes.mjs';
import { officeReport, kpis } from '../reporting.mjs';
import { collectArtifacts, filterArtifacts, ARTIFACT_KINDS } from './artifacts.mjs';
import { extractDocument } from '../documents.mjs';

export function registerApi(router, ctx) {
  const { office, engine, models, settings, toolStore, hub, knowledge, bus, routines, audit, projects, vault } = ctx;
  const record = entry => { try { audit?.record(entry); } catch (error) { console.warn('audit:', error.message); } };
  const withoutRevision = ({ revision, ...rest }) => rest;
  // Connectors without their secrets: env values and tokens are reduced to names and flags.
  const toolSnapshot = () => toolStore.items.map(i => ({ name: i.name, type: i.config?.type, url: i.config?.url, command: i.config?.command, args: i.config?.args, env: Object.keys(i.config?.env || {}), bearer: i.config?.headers?.Authorization ? 'set' : '', signedIn: !!i.oauth?.tokens }));
  const audited = (area, summary, run) => { const before = area === 'tools' ? toolSnapshot() : undefined; const result = run(); if (area === 'tools') record({ area, summary, before, after: toolSnapshot() }); return result; };
  const ready = () => { if (!models.ready()) throw httpError('Add a model key in Settings → Models & keys before starting work.', 409); };
  const task = id => { const job = engine.get(id); if (!job) throw httpError('No such task.', 404); return job; };
  const accepted = value => ({ $status: 202, body: value });
  /* ---------- tasks ---------- */
  router.on('GET', '/api/tasks', () => { const o = office.get(); return engine.list().map(j => listShape(j, o)); });
  // The task form's project picker: open projects only.
  router.on('GET', '/api/projects/open', () => projects.list().filter(p => ['active', 'paused'].includes(p.status)).map(p => ({ id: p.id, name: p.name, status: p.status })));
  router.on('POST', '/api/tasks', async ({ req }) => { const input = await body(req); if (!String(input.text || '').trim()) throw httpError('Describe the task first.', 400); if (!input.backlog) ready(); return accepted(engine.create({ ...input, kind: 'task', testId: undefined })); });
  router.on('GET', '/api/tasks/:id', ({ params }) => { task(params.id); return { ...detailShape(engine.detail(params.id), office.get()), files: engine.files(params.id) }; });
  // A file from the task's workspace (a PDF the team exported, a CSV it wrote), streamed as a download. Paths never leave /work/.
  // Every file every task produced, filtered by kind, date and words; newest first.
  // The Vault: entries without their secrets; a secret is write-only (a blank field keeps it, clearSecret removes it); the audit log sees no secret.
  router.on('GET', '/api/vault', () => ({ kinds: VAULT_KINDS, entries: vault ? vault.list() : [] }));
  router.on('PUT', '/api/vault/:id', async ({ req, params }) => { if (!vault) throw httpError('The Vault is not available.', 503); const before = vault.list(); const entry = vault.upsert({ ...(await body(req)), id: params.id }); record({ area: 'vault', summary: `Vault: saved ${entry.kind} entry ${entry.id}`, before, after: vault.list() }); bus.publish('office.updated', { area: 'vault' }); return entry; });
  router.on('DELETE', '/api/vault/:id', ({ params }) => { if (!vault) throw httpError('The Vault is not available.', 503); const before = vault.list(); const out = vault.remove(params.id); record({ area: 'vault', summary: `Vault: removed ${params.id}`, before, after: vault.list() }); bus.publish('office.updated', { area: 'vault' }); return out; });
  router.on('GET', '/api/artifacts', ({ url }) => { const q = url.searchParams; const rows = filterArtifacts(collectArtifacts({ jobs: engine.list(), filesFor: id => engine.files(id), office: office.get() }), { kind: q.get('kind') || '', from: q.get('from') || '', to: q.get('to') || '', q: q.get('q') || '' }); return { kinds: ARTIFACT_KINDS, total: rows.length, artifacts: rows.slice(0, 500) }; });
  router.on('GET', '/api/tasks/:id/file', ({ params, url, res }) => {
    task(params.id);
    let file; try { file = workspaceFile(engine.workspaceDir(params.id), url.searchParams.get('path') || ''); } catch (error) { return { $status: 400, body: { error: error.message } }; }
    if (!fs.existsSync(file.abs) || !fs.statSync(file.abs).isFile()) return { $status: 404, body: { error: 'There is no such file in this task.' } };
    res.writeHead(200, { 'content-type': mimeOf(file.rel), 'content-length': fs.statSync(file.abs).size, 'content-disposition': `attachment; filename="${path.basename(file.rel).replace(/[^\w. -]/g, '_')}"`, 'cache-control': 'no-store' });
    fs.createReadStream(file.abs).pipe(res); return { $handled: true };
  });
  router.on('POST', '/api/tasks/:id/queue', async ({ req, params }) => { const input = await body(req); if (input.state === 'queued') ready(); return engine.editQueue(params.id, input); });
  router.on('POST', '/api/tasks/:id/cancel', ({ params }) => engine.cancel(params.id));
  router.on('POST', '/api/tasks/:id/seen', ({ params }) => engine.markSeen(params.id));
  router.on('POST', '/api/tasks/:id/retry', async ({ req, params }) => { ready(); return accepted(engine.retry(params.id, (await body(req)).feedback)); });
  router.on('POST', '/api/tasks/:id/message', async ({ req, params }) => { const input = await body(req); ready(); return engine.message(params.id, { text: input.text, kind: ['question', 'correction', 'note', 'message'].includes(input.kind) ? input.kind : 'message', agent: input.agent || null, refs: input.refs, remember: ['agent', 'team'].includes(input.remember) ? input.remember : null }); });
  router.on('POST', '/api/tasks/:id/answer', async ({ req, params }) => { ready(); return engine.answer(params.id, (await body(req)).text); });
  router.on('POST', '/api/tasks/:id/decide', async ({ req, params }) => { const input = await body(req); ready(); return engine.decide(params.id, input.decisions ?? input); });
  // The current task view still sends approve/reject.
  router.on('POST', '/api/tasks/:id/approve', ({ params }) => { const job = task(params.id); ready(); return engine.decide(params.id, job.pendingActions.map(() => ({ type: 'approve' }))); });
  router.on('POST', '/api/tasks/:id/reject', async ({ req, params }) => {
    const job = task(params.id), feedback = String((await body(req)).feedback || '').trim(); if (!feedback) throw httpError('Explain what should change.'); ready();
    return job.state === 'awaiting_ceo' ? engine.decide(params.id, job.pendingActions.map(() => ({ type: 'reject', message: feedback }))) : engine.message(params.id, { text: feedback, kind: 'correction' });
  });
  // The @ picker in a lead's chat: that team's tasks, open ones first, newest first.
  router.on('GET', '/api/teams/:dept/tasks', ({ params, url }) => {
    const q = String(url.searchParams.get('q') || '').toLowerCase(), closed = j => ['done', 'cancelled'].includes(j.state) ? 1 : 0;
    return engine.list().filter(j => (j.depts || [j.dept]).includes(params.dept) && j.kind !== 'evaluation' && (!q || j.title.toLowerCase().includes(q)))
      .sort((a, b) => closed(a) - closed(b) || b.createdAt - a.createdAt).slice(0, 30).map(j => ({ id: j.id, title: j.title, state: j.state, createdAt: j.createdAt, doneAt: j.doneAt || null }));
  });
  router.on('GET', '/api/threads/:id', ({ params, url }) => engine.threads.list(params.id, { after: Number(url.searchParams.get('after')) || 0 }));
  /* ---------- inbox and live updates ---------- */
  router.on('GET', '/api/inbox', ({ url }) => ({ items: engine.notifications.list({ open: url.searchParams.get('open') === '1', limit: Number(url.searchParams.get('limit')) || 100 }), counts: engine.notifications.counts() }));
  router.on('POST', '/api/inbox/read-all', () => engine.notifications.readAll());
  router.on('POST', '/api/inbox/:id/read', ({ params }) => engine.notifications.read(params.id));
  router.on('POST', '/api/inbox/:id/ack', ({ params }) => engine.notifications.ack(params.id));
  router.on('GET', '/api/events', ({ req, res, url, session }) => { bus.handle(req, res, { session, lastEventId: url.searchParams.get('lastEventId') }); return { $handled: true }; });
  /* ---------- models, settings, office ---------- */
  router.on('GET', '/api/providers', () => models.summary());
  router.on('PUT', '/api/providers', async ({ req }) => { const before = structuredClone(models.value); const result = models.update(await body(req, 1024 * 1024)); record({ area: 'providers', summary: 'Updated models and keys', before, after: models.value }); bus.publish('office.updated', { area: 'providers' }); return result; });
  router.on('POST', '/api/providers/:id/test', ({ params }) => models.test(params.id));
  router.on('GET', '/api/providers/:id/models', ({ params }) => models.listModels(params.id));
  router.on('GET', '/api/settings', () => settings.get());
  router.on('PUT', '/api/settings', async ({ req }) => { const before = settings.get(); const result = settings.update(await body(req)); record({ area: 'settings', summary: 'Updated office settings', before, after: result }); bus.publish('office.updated', { area: 'settings' }); return result; });
  router.on('GET', '/api/office', () => office.get());
  router.on('GET', '/api/agents', () => ({ agents: office.agents() }));
  router.on('PUT', '/api/office', async ({ req }) => {
    const next = await body(req, 16 * 1024 * 1024);
    const removed = office.get().teams.filter(t => !next.teams?.some(n => n.id === t.id)).map(t => t.id);
    const busy = engine.list().filter(j => !['done', 'cancelled'].includes(j.state) && (j.depts || [j.dept]).some(d => removed.includes(d)));
    if (busy.length) throw httpError(`Finish or cancel these tasks before removing the team: ${busy.slice(0, 5).map(j => j.title).join('; ')}.`, 409);
    const before = office.get(); const updated = office.update(next, engine.activeAgents());
    record({ area: 'office', summary: 'Updated teams and people', before: withoutRevision(before), after: withoutRevision(updated) }); bus.publish('office.updated', { area: 'office', revision: updated.revision }); return updated;
  });
  router.on('POST', '/api/teams/:dept/tests', ({ params }) => { ready(); return accepted(engine.createTestSuite(params.dept)); });
  router.on('POST', '/api/teams/:dept/test', async ({ req, params }) => {
    ready(); const input = await body(req), team = office.team(params.dept), testcase = team?.tests.find(t => t.id === input.testId);
    if (!testcase) throw httpError('Choose a saved team test.');
    return accepted(engine.create({ dept: team.id, text: testcase.prompt, kind: 'evaluation', testId: testcase.id }));
  });
  /* ---------- connectors ---------- */
  router.on('GET', '/api/tools', async ({ url }) => { if (url.searchParams.has('refresh')) { await ctx.discover().catch(() => {}); await hub.load().catch(() => {}); } return toolStore.list(); });
  router.on('POST', '/api/tools', async ({ req }) => { const input = await body(req, 4 * 1024 * 1024); return audited('tools', `Saved connector ${input.name}`, () => toolStore.save(input)); });
  router.on('DELETE', '/api/tools/:id', ({ params }) => audited('tools', `Removed connector ${params.id}`, () => toolStore.remove(params.id)));
  router.on('POST', '/api/tools/:id/import', ({ params }) => audited('tools', `Imported connector ${params.id}`, () => toolStore.importCandidate(params.id)));
  router.on('POST', '/api/tools/:id/oauth/start', ({ params, origin }) => toolStore.oauthStart(params.id, origin));
  router.on('POST', '/api/tools/:id/oauth/logout', ({ params }) => audited('tools', `Signed out of connector ${params.id}`, () => toolStore.oauthLogout(params.id)));
  router.on('GET', '/api/tools/catalog', () => hub.catalog());
  /* ---------- reports, Brain, routines, health ---------- */
  router.on('GET', '/api/reports', ({ url }) => { const o = office.get(); return officeReport({ jobs: engine.list().map(j => ({ ...listShape(j, o), reviews: j.reviews })), office: o, days: Number(url.searchParams.get('days') ?? 7) }); });
  router.on('GET', '/api/kpis', ({ url }) => kpis({ jobs: engine.list(), events: id => engine.events(id), office: office.get(), days: Number(url.searchParams.get('days') ?? 7) }));
  router.on('GET', '/api/audit', ({ url }) => audit.list({ limit: Number(url.searchParams.get('limit')) || 200, area: url.searchParams.get('area') || null }));
  router.on('GET', '/api/brain', () => ctx.graph());
  router.on('GET', '/api/knowledge', () => knowledge.list());
  router.on('GET', '/api/knowledge/folders', () => knowledge.folders());
  router.on('GET', '/api/knowledge/search', ({ url }) => ctx.index.search(url.searchParams.get('q') || '', { folder: url.searchParams.get('folder') || '', k: Number(url.searchParams.get('k')) || 8 }));
  router.on('GET', '/api/knowledge/status', () => ctx.index.status());
  router.on('POST', '/api/knowledge/reindex', () => { const result = ctx.index.rebuild(); record({ area: 'brain', summary: `Rebuilt the Brain search index (${result.notes} notes)` }); return result; });
  router.on('POST', '/api/knowledge/upload', async ({ req }) => {
    const input = await body(req, 36 * 1024 * 1024), doc = await extractDocument({ name: input.name, data: input.data });
    const note = await knowledge.upload({ folder: input.folder, name: doc.name, content: doc.content });
    record({ area: 'brain', summary: `${note.replaced ? 'Replaced' : 'Uploaded'} ${doc.name} in ${input.folder || 'Company'}` });
    return { id: note.id, replaced: note.replaced, characters: doc.characters };
  });
  router.on('POST', '/api/knowledge', async ({ req }) => knowledge.save(await body(req, 512 * 1024)));
  router.on('GET', '/api/knowledge/note', ({ url }) => knowledge.read(url.searchParams.get('id')));
  router.on('DELETE', '/api/knowledge/note', ({ url }) => knowledge.archive(url.searchParams.get('id')));
  /* ---------- the Agency: ready-made people and methods ---------- */
  router.on('GET', '/api/agency', ({ url }) => ({ divisions: ctx.agency.divisions(), personas: ctx.agency.list({ q: url.searchParams.get('q') || '', division: url.searchParams.get('division') || '' }) }));
  router.on('GET', '/api/agency/:id', ({ params }) => { const { body, ...p } = ctx.agency.get(params.id); return { ...p, body: body.slice(0, 20000) }; });
  router.on('POST', '/api/agency/:id/hire', async ({ req, params }) => { const input = await body(req); return audited('office', `Hired ${params.id} from the Agency into ${input.dept}`, () => { const r = ctx.agency.hire(office, params.id, { dept: input.dept, name: input.name, lead: !!input.lead, busy: engine.activeAgents() }); bus.publish('office.updated', { area: 'office' }); return r; }); });
  router.on('POST', '/api/agency/:id/skill', async ({ req, params }) => { const input = await body(req); return audited('office', `Added the ${params.id} method from the Agency as a skill`, () => { const r = ctx.agency.addSkill(office, params.id, { teams: input.teams || [], agents: input.agents || [], busy: engine.activeAgents() }); bus.publish('office.updated', { area: 'office' }); return r; }); });
  // Projects: the big pieces of work. The office keeps a page per project in the Brain; files upload into the project's folder.
  const projectOut = p => ({ ...p, folder: projects.folder(p), page: projects.pageId(p), next: projects.nextMilestone(p), tasks: engine.list().filter(j => j.projectId === p.id).length, open: engine.list().filter(j => j.projectId === p.id && !['done', 'cancelled'].includes(j.state)).length });
  router.on('GET', '/api/projects', () => ({ projects: projects.list().map(projectOut), teams: office.get().teams.map(t => ({ id: t.id, name: t.name })) }));
  router.on('POST', '/api/projects', async ({ req }) => { const input = await body(req, 256 * 1024); const p = projects.create(input); record({ area: 'projects', summary: `Created project “${p.name}”` }); ctx.syncProject?.(p.id); bus.publish('office.updated', { area: 'projects' }); return projectOut(p); });
  router.on('GET', '/api/projects/:id', ({ params }) => { const p = projects.get(params.id); if (!p) throw httpError('There is no such project.', 404); const o = office.get(); return { project: projectOut(p), tasks: engine.list().filter(j => j.projectId === p.id).map(j => listShape(j, o)), files: knowledge.list().filter(n => n.id.startsWith(projects.folder(p) + '/') && n.id !== projects.pageId(p)) }; });
  router.on('PUT', '/api/projects/:id', async ({ req, params }) => { const input = await body(req, 256 * 1024); const p = projects.update(params.id, input); record({ area: 'projects', summary: `Updated project “${p.name}”` }); ctx.syncProject?.(p.id); bus.publish('office.updated', { area: 'projects' }); return projectOut(p); });
  router.on('POST', '/api/projects/:id/status', async ({ req, params }) => { const { status } = await body(req); const p = projects.setStatus(params.id, status); record({ area: 'projects', summary: `Project “${p.name}” is now ${p.status}` }); ctx.syncProject?.(p.id); bus.publish('office.updated', { area: 'projects' }); return projectOut(p); });
  // Deleting a project: refused while it has open work; finished tasks are detached and kept; the files stay in the Brain; the page is archived.
  router.on('DELETE', '/api/projects/:id', async ({ params }) => {
    const p = projects.get(params.id); if (!p) throw httpError('There is no such project.', 404);
    const mine = engine.list().filter(j => j.projectId === p.id), open = mine.filter(j => !['done', 'cancelled'].includes(j.state));
    if (open.length) throw httpError(`“${p.name}” still has ${open.length} open task${open.length === 1 ? '' : 's'}. Cancel or finish them first, or archive the project instead.`, 409);
    for (const j of mine) engine.update(j.id, x => { x.projectId = null; x.projectName = null; });
    try { await knowledge.archive(projects.pageId(p)); } catch {}
    projects.remove(p.id); record({ area: 'projects', summary: `Deleted project “${p.name}” (${mine.length} finished task${mine.length === 1 ? '' : 's'} kept, files kept in the Brain)` });
    bus.publish('office.updated', { area: 'projects' }); return { ok: true, detached: mine.length, folder: projects.folder(p) };
  });
  router.on('POST', '/api/projects/:id/upload', async ({ req, params }) => {
    const p = projects.get(params.id); if (!p) throw httpError('There is no such project.', 404);
    const input = await body(req, 36 * 1024 * 1024), doc = await extractDocument({ name: input.name, data: input.data });
    const note = await knowledge.upload({ folder: projects.folder(p), name: doc.name, content: doc.content });
    record({ area: 'projects', summary: `${note.replaced ? 'Replaced' : 'Added'} ${doc.name} in project “${p.name}”` }); ctx.syncProject?.(p.id);
    return { id: note.id, replaced: note.replaced, characters: doc.characters };
  });
  router.on('GET', '/api/routines', () => routines.out());
  router.on('POST', '/api/routines', async ({ req }) => { const r = await routines.make(await body(req)); return r.error ? { $status: 400, body: r } : r; });
  router.on('DELETE', '/api/routines/:id', ({ params }) => routines.remove(params.id));
  router.on('POST', '/api/routines/:id', async ({ req, params }) => routines.patch(params.id, await body(req)));
  router.on('POST', '/api/routines/:id/run', ({ params }) => { ready(); return routines.run(params.id); });
  router.on('POST', '/api/routines/:id/pause', ({ params }) => routines.pause(params.id, true));
  router.on('POST', '/api/routines/:id/resume', ({ params }) => routines.pause(params.id, false));
  router.on('POST', '/api/chat', async ({ req }) => ctx.chat(await body(req)));
  router.on('POST', '/api/assist', async ({ req }) => ctx.assist(await body(req)));
  // Compatibility for the scene: connector docks (was the Claude Code list) and the top-bar usage gauge (was the Claude plan).
  router.on('GET', '/api/mcp', () => {
    const teams = office.get().teams, key = name => String(name).toLowerCase().replace(/^claude[ ._]ai[ ._]/, '').replace(/[^a-z0-9]/g, '');
    return { tools: true, web: teams.some(t => t.tools.includes('web')), servers: toolStore.list().filter(t => !['builtin', 'candidate'].includes(t.type)).map(t => ({ id: t.id, key: key(t.name), name: t.name, allowed: true,
      status: t.type === 'stdio' || t.auth === 'signed-in' || t.hasToken ? 'connected' : 'needs-auth', depts: teams.filter(x => x.tools.includes(t.id)).map(x => x.id) })) };
  });
  router.on('GET', '/api/usage', () => {
    const since = Date.now() - 5 * 3600000; let tokens = 0, runs = 0;
    for (const j of engine.list()) { if ((j.updatedAt || 0) >= since) tokens += j.tokens || 0; runs += (j.runs || []).filter(r => (r.startedAt || 0) >= since).length; }
    return { ok: true, source: 'office', reason: 'the office runs on API keys', window: { tokens, runs } };
  });
  router.on('GET', '/api/health', () => { const o = office.get(); return { ok: true, version: ctx.version, name: ctx.name, ready: models.ready(), providers: models.summary(), depts: o.teams.map(t => t.id), teams: o.teams.map(t => ({ id: t.id, name: t.name, lead: t.lead })),
    agents: o.agents.map(({ id, name, role, does, department, lead }) => ({ id, name, role, does, department, lead })), notes: ctx.graph().notes, knowledge: ctx.index.status(), connectors: hub.status, inbox: engine.notifications.counts(), settings: settings.get(), provider: engine.providerHealth(), faults: engine.faults.slice(-5) }; });
}
