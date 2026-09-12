// Every /api route of one office. `ctx` carries the stores and the engine built in office-instance.mjs. Each handler receives
// the viewer as `user`: null in a single-owner office (everything is visible), else { id, role, groups, tenantId }.
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
import { ATTACHMENT_MAX_ENCODED } from '../channels/channel.mjs';
import { planProject, applyPlan, loadPlanningSkills, loadCatalogueMethods, startNextMilestone } from '../project-planner.mjs';
import { ROOT } from '../config.mjs';
import { registerProviderRoutes } from './providers-api.mjs';
import { canSeeJob, canSeeProject, canShare, visibleJobs, requireRole, isAdmin, notificationVisible, sseFilter, INVISIBLE } from './visibility.mjs';

export function registerApi(router, ctx) {
  const { office, engine, models, settings, toolStore, hub, knowledge, bus, routines, audit, projects, vault, tenant = null, managedModels = false } = ctx;
  const record = entry => { try { audit?.record(entry); } catch (error) { console.warn('audit:', error.message); } };
  const withoutRevision = ({ revision, ...rest }) => rest;
  // Connectors without their secrets: env values and tokens are reduced to names and flags.
  const toolSnapshot = () => toolStore.items.map(i => ({ name: i.name, type: i.config?.type, url: i.config?.url, command: i.config?.command, args: i.config?.args, env: Object.keys(i.config?.env || {}), bearer: i.config?.headers?.Authorization ? 'set' : '', signedIn: !!i.oauth?.tokens }));
  const audited = (area, summary, run) => { const before = area === 'tools' ? toolSnapshot() : undefined; const result = run(); if (area === 'tools') record({ area, summary, before, after: toolSnapshot() }); return result; };
  const ready = () => { if (!models.ready()) throw httpError(managedModels ? 'No model is ready on this platform yet. Ask the platform administrator.' : 'Add a model key in Settings → Models & keys before starting work.', 409); };
  const accepted = value => ({ $status: 202, body: value });
  /* ---------- who sees what ---------- */
  const projectFor = id => id ? projects.get(id) : null;
  // The task, if this viewer may see it; 404 when it does not exist, 403 when it belongs to someone else.
  const see = (id, user) => { const job = engine.get(id); if (!job) throw httpError('No such task.', 404); if (!canSeeJob(user, job, { project: projectFor(job.projectId) })) throw httpError(INVISIBLE, 403); return job; };
  const mine = user => visibleJobs(user, engine.list(), { projectFor });
  const admin = user => requireRole(user, ['owner', 'admin']);
  const inboxScope = user => ({ userId: user?.id || null, admin: isAdmin(user) });
  const ids = list => [...new Set((Array.isArray(list) ? list : []).map(v => String(v ?? '').trim()).filter(Boolean))].slice(0, 50);
  // Visibility and share lists from a request; in a hosted office the ids must name members and groups of this office.
  const audience = (user, input, previous = null) => {
    const visibility = input.visibility === undefined ? previous?.visibility || 'private' : input.visibility;
    if (!['private', 'public'].includes(visibility)) throw httpError('Visibility must be private or public.');
    const raw = input.sharedWith === undefined ? previous?.sharedWith || {} : input.sharedWith || {};
    const sharedWith = tenant?.audience ? tenant.audience(raw) : { users: ids(raw.users), groups: ids(raw.groups) };
    return { visibility, sharedWith };
  };
  const project = (id, user) => { const p = projects.get(id); if (!p) throw httpError('There is no such project.', 404); if (!canSeeProject(user, p)) throw httpError('This project belongs to someone else in the office.', 403); return p; };
  const projectEditor = (p, user) => { if (!canShare(user, p)) throw httpError('Only the project’s owner or an office admin can change it.', 403); };
  /* ---------- tasks ---------- */
  router.on('GET', '/api/tasks', ({ user }) => { const o = office.get(); return mine(user).map(j => listShape(j, o)); });
  // The task form's project picker: open projects only.
  // Every project that can still take work: the board decides which of them to draw, the task form offers them all.
  router.on('GET', '/api/projects/open', ({ user }) => projects.list().filter(p => p.status !== 'archived' && canSeeProject(user, p)).map(p => ({ id: p.id, name: p.name, status: p.status, dueAt: p.dueAt || null, doneAt: p.doneAt || null, milestones: (p.milestones || []).map(m => ({ id: m.id, title: m.title, done: !!m.done, dueAt: m.dueAt || null, doneAt: m.doneAt || null, ...(Array.isArray(m.after) ? { after: m.after } : {}) })) })));
  router.on('POST', '/api/tasks', async ({ req, user }) => {
    const input = await body(req); if (!String(input.text || '').trim()) throw httpError('Describe the task first.', 400); if (!input.backlog) ready();
    if (input.projectId) project(String(input.projectId), user);
    return accepted(engine.create({ ...input, kind: 'task', testId: undefined, ownerId: user?.id || null, origin: { channel: 'web' }, ...audience(user, input) }));
  });
  router.on('GET', '/api/tasks/:id', ({ params, user }) => { see(params.id, user); return { ...detailShape(engine.detail(params.id), office.get()), files: engine.files(params.id) }; });
  // Files for a task before it starts (the composer's documents): they land under /work/inbox/ and, when the task belongs to a project, their text is filed in the project's Brain folder.
  router.on('POST', '/api/tasks/:id/attach', async ({ req, params, user }) => {
    const job = see(params.id, user); if (job.startedAt) throw httpError('This task has started; add the file as a note with a Brain upload instead.', 409);
    const input = await body(req, ATTACHMENT_MAX_ENCODED); if (!input.name || !input.data) throw httpError('Send the file name and its content.');
    const bytes = Buffer.from(String(input.data), 'base64'), out = engine.attach(job.id, [{ name: input.name, contentType: input.type || '', bytes }]);
    if (job.projectId) { try { const doc = await extractDocument({ name: out.saved[0].name, data: input.data }); if (doc.content?.trim()) await knowledge.upload({ folder: projects.folder(projects.get(job.projectId)), name: doc.name, content: doc.content }); } catch (error) { console.warn('attachment to Brain:', error.message); } }
    return { attachments: out.attachments };
  });
  // Who sees a task: its owner or an office admin may change it. Everyone hears the record left, then those who may see it get it back.
  router.on('POST', '/api/tasks/:id/share', async ({ req, params, user }) => {
    const job = see(params.id, user); if (!canShare(user, job)) throw httpError('Only the task’s owner or an office admin can change who sees it.', 403);
    const a = audience(user, await body(req), job), updated = engine.share(job.id, a);
    record({ area: 'tasks', summary: `“${job.title}” is now ${a.visibility}${a.visibility === 'private' && (a.sharedWith.users.length || a.sharedWith.groups.length) ? `, shared with ${a.sharedWith.users.length} people and ${a.sharedWith.groups.length} groups` : ''}`, before: { visibility: job.visibility, sharedWith: job.sharedWith }, after: a });
    return listShape(updated, office.get());
  });
  // The Vault: entries without their secrets; a secret is write-only (a blank field keeps it, clearSecret removes it); the audit log sees no secret.
  router.on('GET', '/api/vault', ({ user }) => { admin(user); return { kinds: VAULT_KINDS, entries: vault ? vault.list() : [] }; });
  router.on('PUT', '/api/vault/:id', async ({ req, params, user }) => { admin(user); if (!vault) throw httpError('The Vault is not available.', 503); const before = vault.list(); const entry = vault.upsert({ ...(await body(req)), id: params.id }); record({ area: 'vault', summary: `Vault: saved ${entry.kind} entry ${entry.id}`, before, after: vault.list() }); bus.publish('office.updated', { area: 'vault' }); return entry; });
  router.on('DELETE', '/api/vault/:id', ({ params, user }) => { admin(user); if (!vault) throw httpError('The Vault is not available.', 503); const before = vault.list(); const out = vault.remove(params.id); record({ area: 'vault', summary: `Vault: removed ${params.id}`, before, after: vault.list() }); bus.publish('office.updated', { area: 'vault' }); return out; });
  // Every file every task produced, filtered by kind, date and words; newest first.
  router.on('GET', '/api/artifacts', ({ url, user }) => { const q = url.searchParams; const rows = filterArtifacts(collectArtifacts({ jobs: mine(user), filesFor: id => engine.files(id), office: office.get() }), { kind: q.get('kind') || '', from: q.get('from') || '', to: q.get('to') || '', q: q.get('q') || '' }); return { kinds: ARTIFACT_KINDS, total: rows.length, artifacts: rows.slice(0, 500) }; });
  // A file from the task's workspace (a PDF the team exported, a CSV it wrote), streamed as a download. Paths never leave /work/.
  router.on('GET', '/api/tasks/:id/file', ({ params, url, res, user }) => {
    see(params.id, user);
    let file; try { file = workspaceFile(engine.workspaceDir(params.id), url.searchParams.get('path') || ''); } catch (error) { return { $status: 400, body: { error: error.message } }; }
    if (!fs.existsSync(file.abs) || !fs.statSync(file.abs).isFile()) return { $status: 404, body: { error: 'There is no such file in this task.' } };
    // ?inline=1 shows the file in the browser (a PDF, an image, a page); without it the browser saves it.
    const how = url.searchParams.get('inline') === '1' ? 'inline' : 'attachment';
    res.writeHead(200, { 'content-type': mimeOf(file.rel), 'content-length': fs.statSync(file.abs).size, 'content-disposition': `${how}; filename="${path.basename(file.rel).replace(/[^\w. -]/g, '_')}"`, 'cache-control': 'no-store' });
    fs.createReadStream(file.abs).pipe(res); return { $handled: true };
  });
  router.on('POST', '/api/tasks/:id/queue', async ({ req, params, user }) => { see(params.id, user); const input = await body(req); if (input.state === 'queued') ready(); return engine.editQueue(params.id, input); });
  router.on('POST', '/api/tasks/:id/cancel', ({ params, user }) => { see(params.id, user); return engine.cancel(params.id); });
  router.on('POST', '/api/tasks/:id/seen', ({ params, user }) => { see(params.id, user); return engine.markSeen(params.id); });
  router.on('POST', '/api/tasks/:id/retry', async ({ req, params, user }) => { see(params.id, user); ready(); return accepted(engine.retry(params.id, (await body(req)).feedback)); });
  router.on('POST', '/api/tasks/:id/message', async ({ req, params, user }) => { see(params.id, user); const input = await body(req); ready(); return engine.message(params.id, { text: input.text, kind: ['question', 'correction', 'note', 'message'].includes(input.kind) ? input.kind : 'message', agent: input.agent || null, refs: input.refs, remember: ['agent', 'team'].includes(input.remember) ? input.remember : null }); });
  router.on('POST', '/api/tasks/:id/answer', async ({ req, params, user }) => { see(params.id, user); ready(); return engine.answer(params.id, (await body(req)).text); });
  router.on('POST', '/api/tasks/:id/decide', async ({ req, params, user }) => { see(params.id, user); const input = await body(req); ready(); return engine.decide(params.id, input.decisions ?? input); });
  // The current task view still sends approve/reject.
  router.on('POST', '/api/tasks/:id/approve', ({ params, user }) => { const job = see(params.id, user); ready(); return engine.decide(params.id, job.pendingActions.map(() => ({ type: 'approve' }))); });
  router.on('POST', '/api/tasks/:id/reject', async ({ req, params, user }) => {
    const job = see(params.id, user), feedback = String((await body(req)).feedback || '').trim(); if (!feedback) throw httpError('Explain what should change.'); ready();
    return job.state === 'awaiting_ceo' ? engine.decide(params.id, job.pendingActions.map(() => ({ type: 'reject', message: feedback }))) : engine.message(params.id, { text: feedback, kind: 'correction' });
  });
  // The @ picker in a lead's chat: that team's tasks, open ones first, newest first.
  router.on('GET', '/api/teams/:dept/tasks', ({ params, url, user }) => {
    const q = String(url.searchParams.get('q') || '').toLowerCase(), closed = j => ['done', 'cancelled'].includes(j.state) ? 1 : 0;
    return mine(user).filter(j => (j.depts || [j.dept]).includes(params.dept) && j.kind !== 'evaluation' && (!q || j.title.toLowerCase().includes(q)))
      .sort((a, b) => closed(a) - closed(b) || b.createdAt - a.createdAt).slice(0, 30).map(j => ({ id: j.id, title: j.title, state: j.state, createdAt: j.createdAt, doneAt: j.doneAt || null }));
  });
  // A task's thread follows the task; a person's chat is the viewer's own ("agent:<id>" is theirs, in a hosted office "agent:<id>:<userId>").
  router.on('GET', '/api/threads/:id', ({ params, url, user }) => {
    let id = params.id;
    if (id.startsWith('agent:')) { const parts = id.split(':'); if (user) { if (parts.length === 2) id = `${id}:${user.id}`; else if (parts[2] !== user.id) throw httpError('That conversation belongs to someone else.', 403); } }
    else see(id, user);
    return engine.threads.list(id, { after: Number(url.searchParams.get('after')) || 0 });
  });
  /* ---------- inbox and live updates ---------- */
  const inboxItem = (id, user) => { const item = engine.notifications.get(id); if (!item) throw httpError('No such inbox item.', 404); if (!notificationVisible(user, item)) throw httpError('That inbox item is someone else’s.', 403); return item; };
  router.on('GET', '/api/inbox', ({ url, user }) => ({ items: engine.notifications.list({ open: url.searchParams.get('open') === '1', limit: Number(url.searchParams.get('limit')) || 100, ...inboxScope(user) }), counts: engine.notifications.counts(inboxScope(user)) }));
  router.on('POST', '/api/inbox/read-all', ({ user }) => engine.notifications.readAll(inboxScope(user)));
  router.on('POST', '/api/inbox/:id/read', ({ params, user }) => { inboxItem(params.id, user); return engine.notifications.read(params.id); });
  router.on('POST', '/api/inbox/:id/ack', ({ params, user }) => { inboxItem(params.id, user); return engine.notifications.ack(params.id); });
  router.on('GET', '/api/events', ({ req, res, url, session, user }) => { bus.handle(req, res, { session, lastEventId: url.searchParams.get('lastEventId'), filter: sseFilter(user, { jobFor: id => engine.get(id), projectFor }) }); return { $handled: true }; });
  /* ---------- models, settings, office ---------- */
  // In a hosted office the models are the platform's: these routes do not exist (404) and the admin panel has them.
  if (!managedModels) registerProviderRoutes(router, models, '/api/providers', { record, onChange: () => bus.publish('office.updated', { area: 'providers' }) });
  router.on('GET', '/api/settings', () => settings.get());
  router.on('PUT', '/api/settings', async ({ req, user }) => { admin(user); const before = settings.get(); const result = settings.update(await body(req)); record({ area: 'settings', summary: 'Updated office settings', before, after: result }); bus.publish('office.updated', { area: 'settings' }); return result; });
  router.on('GET', '/api/office', () => office.get());
  router.on('GET', '/api/agents', () => ({ agents: office.agents() }));
  router.on('PUT', '/api/office', async ({ req, user }) => {
    admin(user);
    const next = await body(req, 16 * 1024 * 1024);
    const removed = office.get().teams.filter(t => !next.teams?.some(n => n.id === t.id)).map(t => t.id);
    const busy = engine.list().filter(j => !['done', 'cancelled'].includes(j.state) && (j.depts || [j.dept]).some(d => removed.includes(d)));
    if (busy.length) throw httpError(`Finish or cancel these tasks before removing the team: ${busy.slice(0, 5).map(j => j.title).join('; ')}.`, 409);
    const before = office.get(); const updated = office.update(next, engine.activeAgents());
    record({ area: 'office', summary: 'Updated teams and people', before: withoutRevision(before), after: withoutRevision(updated) }); bus.publish('office.updated', { area: 'office', revision: updated.revision }); return updated;
  });
  router.on('POST', '/api/teams/:dept/tests', ({ params, user }) => { admin(user); ready(); return accepted(engine.createTestSuite(params.dept)); });
  router.on('POST', '/api/teams/:dept/test', async ({ req, params, user }) => {
    admin(user); ready(); const input = await body(req), team = office.team(params.dept), testcase = team?.tests.find(t => t.id === input.testId);
    if (!testcase) throw httpError('Choose a saved team test.');
    return accepted(engine.create({ dept: team.id, text: testcase.prompt, kind: 'evaluation', testId: testcase.id, ownerId: user?.id || null, origin: { channel: 'web' } }));
  });
  /* ---------- connectors ---------- */
  router.on('GET', '/api/tools', async ({ url, user }) => { admin(user); if (url.searchParams.has('refresh')) { await ctx.discover().catch(() => {}); await hub.load().catch(() => {}); } return toolStore.list(); });
  router.on('POST', '/api/tools', async ({ req, user }) => { admin(user); const input = await body(req, 4 * 1024 * 1024); return audited('tools', `Saved connector ${input.name}`, () => toolStore.save(input)); });
  router.on('DELETE', '/api/tools/:id', ({ params, user }) => { admin(user); return audited('tools', `Removed connector ${params.id}`, () => toolStore.remove(params.id)); });
  router.on('POST', '/api/tools/:id/import', ({ params, user }) => { admin(user); return audited('tools', `Imported connector ${params.id}`, () => toolStore.importCandidate(params.id)); });
  router.on('POST', '/api/tools/:id/oauth/start', ({ params, origin, user }) => { admin(user); return toolStore.oauthStart(params.id, origin); });
  router.on('POST', '/api/tools/:id/oauth/logout', ({ params, user }) => { admin(user); return audited('tools', `Signed out of connector ${params.id}`, () => toolStore.oauthLogout(params.id)); });
  router.on('GET', '/api/tools/catalog', ({ user }) => { admin(user); return hub.catalog(); });
  /* ---------- reports, Brain, routines, health ---------- */
  router.on('GET', '/api/reports', ({ url, user }) => { const o = office.get(); return officeReport({ jobs: mine(user).map(j => ({ ...listShape(j, o), reviews: j.reviews })), office: o, days: Number(url.searchParams.get('days') ?? 7) }); });
  router.on('GET', '/api/kpis', ({ url, user }) => kpis({ jobs: mine(user), events: id => engine.events(id), office: office.get(), days: Number(url.searchParams.get('days') ?? 7) }));
  router.on('GET', '/api/audit', ({ url, user }) => { admin(user); return audit.list({ limit: Number(url.searchParams.get('limit')) || 200, area: url.searchParams.get('area') || null }); });
  router.on('GET', '/api/brain', () => ctx.graph());
  router.on('GET', '/api/knowledge', () => knowledge.list());
  router.on('GET', '/api/knowledge/folders', () => knowledge.folders());
  router.on('GET', '/api/knowledge/search', ({ url }) => ctx.index.search(url.searchParams.get('q') || '', { folder: url.searchParams.get('folder') || '', k: Number(url.searchParams.get('k')) || 8 }));
  router.on('GET', '/api/knowledge/status', () => ctx.index.status());
  router.on('POST', '/api/knowledge/reindex', ({ user }) => { admin(user); const result = ctx.index.rebuild(); record({ area: 'brain', summary: `Rebuilt the Brain search index (${result.notes} notes)` }); return result; });
  router.on('POST', '/api/knowledge/upload', async ({ req }) => {
    const input = await body(req, ATTACHMENT_MAX_ENCODED), doc = await extractDocument({ name: input.name, data: input.data });
    const note = await knowledge.upload({ folder: input.folder, name: doc.name, content: doc.content });
    record({ area: 'brain', summary: `${note.replaced ? 'Replaced' : 'Uploaded'} ${doc.name} in ${input.folder || 'Company'}` });
    return { id: note.id, replaced: note.replaced, characters: doc.characters };
  });
  router.on('POST', '/api/knowledge', async ({ req, user }) => { admin(user); return knowledge.save(await body(req, 512 * 1024)); });
  router.on('GET', '/api/knowledge/note', ({ url }) => knowledge.read(url.searchParams.get('id')));
  // The note as a file, for the links results carry ("Source: /knowledge/…").
  router.on('GET', '/api/knowledge/file', ({ url, res }) => {
    const id = url.searchParams.get('id') || ''; let file; try { file = knowledge.resolve(id); } catch (error) { return { $status: 400, body: { error: error.message } }; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { $status: 404, body: { error: `No note at ${id}.` } };
    const how = url.searchParams.get('inline') === '1' ? 'inline' : 'attachment';
    res.writeHead(200, { 'content-type': how === 'inline' ? 'text/plain; charset=utf-8' : 'text/markdown; charset=utf-8', 'content-length': fs.statSync(file).size, 'content-disposition': `${how}; filename="${path.basename(id).replace(/[^\w. -]/g, '_')}"`, 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res); return { $handled: true };
  });
  router.on('DELETE', '/api/knowledge/note', ({ url, user }) => { admin(user); return knowledge.archive(url.searchParams.get('id')); });
  /* ---------- the Agency: ready-made people and methods ---------- */
  router.on('GET', '/api/agency', ({ url }) => ({ divisions: ctx.agency.divisions(), personas: ctx.agency.list({ q: url.searchParams.get('q') || '', division: url.searchParams.get('division') || '' }) }));
  router.on('GET', '/api/agency/:id', ({ params }) => { const { body, ...p } = ctx.agency.get(params.id); return { ...p, body: body.slice(0, 20000) }; });
  router.on('POST', '/api/agency/:id/hire', async ({ req, params, user }) => { admin(user); const input = await body(req); return audited('office', `Hired ${params.id} from the Agency into ${input.dept}`, () => { const r = ctx.agency.hire(office, params.id, { dept: input.dept, name: input.name, lead: !!input.lead, busy: engine.activeAgents() }); bus.publish('office.updated', { area: 'office' }); return r; }); });
  router.on('POST', '/api/agency/:id/skill', async ({ req, params, user }) => { admin(user); const input = await body(req); return audited('office', `Added the ${params.id} method from the Agency as a skill`, () => { const r = ctx.agency.addSkill(office, params.id, { teams: input.teams || [], agents: input.agents || [], busy: engine.activeAgents() }); bus.publish('office.updated', { area: 'office' }); return r; }); });
  // Projects: the big pieces of work. The office keeps a page per project in the Brain; files upload into the project's folder.
  const projectOut = (p, user) => { const tasks = mine(user).filter(j => j.projectId === p.id); return { ...p, folder: projects.folder(p), page: projects.pageId(p), next: projects.nextMilestone(p), tasks: tasks.length, open: tasks.filter(j => !['done', 'cancelled'].includes(j.state)).length }; };
  router.on('GET', '/api/projects', ({ user }) => ({ projects: projects.list().filter(p => canSeeProject(user, p)).map(p => projectOut(p, user)), teams: office.get().teams.map(t => ({ id: t.id, name: t.name })) }));
  router.on('POST', '/api/projects', async ({ req, user }) => { const input = await body(req, 256 * 1024); const p = projects.create({ ...input, ...audience(user, input) }, { ownerId: user?.id || null }); record({ area: 'projects', summary: `Created project “${p.name}”` }); ctx.syncProject?.(p.id); bus.publish('office.updated', { area: 'projects' }); return projectOut(p, user); });
  // A project from a brief: the Program Manager plans it (name, purpose, charter, teams, dates, milestones, the first tasks); the
  // documents go to its Brain folder; the first milestone's tasks start now, later ones wait for their milestone.
  router.on('POST', '/api/projects/plan', async ({ req, user }) => {
    ready();
    const input = await body(req, ATTACHMENT_MAX_ENCODED * 10), brief = String(input.text || '').trim();
    if (brief.length < 10) throw httpError('Say what the project should build or achieve, in a sentence or two at least.', 400);
    const documents = []; for (const f of (Array.isArray(input.files) ? input.files : []).slice(0, 10)) documents.push(await extractDocument({ name: f.name, data: f.data }));
    const skills = loadPlanningSkills({ dirs: [engine.pmSkillsDir || path.join(ROOT, 'agency', 'pm-skills'), path.join(engine.knowledgeDir, 'Agents Office', 'pm-skills')] });
    const catalogue = loadCatalogueMethods({ agency: ctx.agency, brief });
    const plan = await planProject({ brief, documents: documents.map(d => ({ name: d.name, content: d.content })), skills, catalogue, office: office.get(), models });
    const { project: p, tasks } = applyPlan({ plan, projects, engine, ownerId: user?.id || null, audience: audience(user, input) });
    for (const doc of documents) { try { await knowledge.upload({ folder: projects.folder(p), name: doc.name, content: doc.content }); } catch (error) { console.warn('project document:', error.message); } }
    record({ area: 'projects', summary: `The Program Manager planned project “${p.name}”: ${p.milestones.length} milestone${p.milestones.length === 1 ? '' : 's'}, ${tasks.length} task${tasks.length === 1 ? '' : 's'}; methods read: ${[...skills.map(s => s.name), ...catalogue.map(s => s.name)].join(', ') || 'none'}` });
    ctx.syncProject?.(p.id); bus.publish('office.updated', { area: 'projects' });
    return { project: projectOut(p, user), tasks: tasks.map(t => ({ id: t.id, title: t.title, state: t.state, milestoneId: t.milestoneId })), milestones: p.milestones.length, methods: { builtIn: skills.map(s => s.name), catalogue: catalogue.map(s => s.name) } };
  });
  // The project page: its tasks, the files uploaded to its Brain folder, and every artifact its tasks produced, newest first.
  router.on('GET', '/api/projects/:id', ({ params, user }) => {
    const p = project(params.id, user), o = office.get(), tasks = mine(user).filter(j => j.projectId === p.id);
    const artifacts = collectArtifacts({ jobs: tasks, filesFor: id => engine.files(id), office: o });
    return { project: projectOut(p, user), tasks: tasks.map(j => listShape(j, o)), artifacts, files: knowledge.list().filter(n => n.id.startsWith(projects.folder(p) + '/') && n.id !== projects.pageId(p)) };
  });
  // The Program Manager writes the closing summary again, on the CEO's word.
  router.on('POST', '/api/projects/:id/summary', async ({ params, user }) => {
    const p = project(params.id, user); projectEditor(p, user);
    if (!ctx.writeProjectSummary) throw httpError('This office cannot write project summaries.', 501);
    const summary = await ctx.writeProjectSummary(p.id, { reason: 'the CEO asked' });
    record({ area: 'projects', summary: `Summary written again for “${p.name}”` });
    return { project: projectOut(projects.get(p.id), user), summary };
  });
  router.on('PUT', '/api/projects/:id', async ({ req, params, user }) => {
    const before = project(params.id, user); projectEditor(before, user); const input = await body(req, 256 * 1024);
    const p = projects.update(params.id, { ...input, ...(input.visibility !== undefined || input.sharedWith !== undefined ? audience(user, input, before) : {}) });
    // A milestone switched on by hand starts the next milestone's work, as an achieved one does.
    const reached = (p.milestones || []).filter(m => m.done && !(before.milestones || []).find(b => b.id === m.id)?.done);
    const started = reached.length && p.status === 'active' ? startNextMilestone({ project: p, projects, engine }) : [];
    record({ area: 'projects', summary: `Updated project “${p.name}”${reached.length ? `; milestone${reached.length === 1 ? '' : 's'} reached: ${reached.map(m => m.title).join(', ')}` : ''}${started.length ? `; the next milestone's ${started.length} task${started.length === 1 ? '' : 's'} queued` : ''}` }); ctx.syncProject?.(p.id); bus.publish('office.updated', { area: 'projects' }); return projectOut(p, user);
  });
  router.on('POST', '/api/projects/:id/status', async ({ req, params, user }) => { projectEditor(project(params.id, user), user); const { status } = await body(req); const p = projects.setStatus(params.id, status); record({ area: 'projects', summary: `Project “${p.name}” is now ${p.status}` }); ctx.syncProject?.(p.id); bus.publish('office.updated', { area: 'projects' }); return projectOut(p, user); });
  // Deleting a project: refused while it has open work; finished tasks are detached and kept; the files stay in the Brain; the page is archived.
  router.on('DELETE', '/api/projects/:id', async ({ params, user }) => {
    const p = project(params.id, user); projectEditor(p, user);
    const all = engine.list().filter(j => j.projectId === p.id), open = all.filter(j => !['done', 'cancelled'].includes(j.state));
    if (open.length) throw httpError(`“${p.name}” still has ${open.length} open task${open.length === 1 ? '' : 's'}. Cancel or finish them first, or archive the project instead.`, 409);
    for (const j of all) engine.update(j.id, x => { x.projectId = null; x.projectName = null; });
    try { await knowledge.archive(projects.pageId(p)); } catch {}
    projects.remove(p.id); record({ area: 'projects', summary: `Deleted project “${p.name}” (${all.length} finished task${all.length === 1 ? '' : 's'} kept, files kept in the Brain)` });
    bus.publish('office.updated', { area: 'projects' }); return { ok: true, detached: all.length, folder: projects.folder(p) };
  });
  router.on('POST', '/api/projects/:id/upload', async ({ req, params, user }) => {
    const p = project(params.id, user);
    const input = await body(req, ATTACHMENT_MAX_ENCODED), doc = await extractDocument({ name: input.name, data: input.data });
    const note = await knowledge.upload({ folder: projects.folder(p), name: doc.name, content: doc.content });
    record({ area: 'projects', summary: `${note.replaced ? 'Replaced' : 'Added'} ${doc.name} in project “${p.name}”` }); ctx.syncProject?.(p.id);
    return { id: note.id, replaced: note.replaced, characters: doc.characters };
  });
  // Routines are the office's timetable: everyone sees it; a routine is changed by whoever made it or an office admin.
  router.on('GET', '/api/routines', () => routines.out());
  router.on('POST', '/api/routines', async ({ req, user }) => { const r = await routines.make(await body(req), user); return r.error ? { $status: 400, body: r } : r; });
  router.on('DELETE', '/api/routines/:id', ({ params, user }) => routines.remove(params.id, user));
  router.on('POST', '/api/routines/:id', async ({ req, params, user }) => routines.patch(params.id, await body(req), user));
  router.on('POST', '/api/routines/:id/run', ({ params, user }) => { ready(); return routines.run(params.id, user); });
  router.on('POST', '/api/routines/:id/pause', ({ params, user }) => routines.pause(params.id, true, user));
  router.on('POST', '/api/routines/:id/resume', ({ params, user }) => routines.pause(params.id, false, user));
  router.on('POST', '/api/chat', async ({ req, user }) => { const input = await body(req); if (input.taskId) see(String(input.taskId), user); return ctx.chat(input, user); });
  router.on('POST', '/api/assist', async ({ req, user }) => { admin(user); return ctx.assist(await body(req)); });
  // Compatibility for the scene: connector docks (was the Claude Code list) and the top-bar usage gauge (was the Claude plan).
  router.on('GET', '/api/mcp', () => {
    const teams = office.get().teams, key = name => String(name).toLowerCase().replace(/^claude[ ._]ai[ ._]/, '').replace(/[^a-z0-9]/g, '');
    return { tools: true, web: teams.some(t => t.tools.includes('web')), servers: toolStore.list().filter(t => !['builtin', 'candidate'].includes(t.type)).map(t => ({ id: t.id, key: key(t.name), name: t.name, allowed: true,
      status: t.type === 'stdio' || t.auth === 'signed-in' || t.hasToken ? 'connected' : 'needs-auth', depts: teams.filter(x => x.tools.includes(t.id)).map(x => x.id) })) };
  });
  router.on('GET', '/api/usage', ({ user }) => {
    const since = Date.now() - 5 * 3600000; let tokens = 0, runs = 0;
    for (const j of mine(user)) { if ((j.updatedAt || 0) >= since) tokens += j.tokens || 0; runs += (j.runs || []).filter(r => (r.startedAt || 0) >= since).length; }
    return { ok: true, source: 'office', reason: 'the office runs on API keys', window: { tokens, runs } };
  });
  router.on('GET', '/api/health', ({ user }) => { const o = office.get(); return { ok: true, version: ctx.version, name: ctx.name, mode: tenant ? 'hosted' : 'single', ready: models.ready(), providers: managedModels ? { managed: true, ready: models.ready() } : models.summary(), limits: { ...office.limits }, platform: { managedModels }, depts: o.teams.map(t => t.id), teams: o.teams.map(t => ({ id: t.id, name: t.name, lead: t.lead })),
    agents: o.agents.map(({ id, name, role, does, department, lead }) => ({ id, name, role, does, department, lead })), notes: ctx.graph().notes, knowledge: ctx.index.status(), connectors: hub.status, inbox: engine.notifications.counts(inboxScope(user)), settings: settings.get(), provider: engine.providerHealth(), faults: isAdmin(user) ? engine.faults.slice(-5) : [] }; });
}
