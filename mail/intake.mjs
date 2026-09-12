// Mail becomes work. A message to a member's alias (<office>.<person>.<suffix>@domain) from a verified sender becomes a task
// for the Program Manager: subject → title, body → brief, attachments → the task's files. A question is work too and goes
// the same way, so the lane that takes it has the Brain search and the exports. A reply on a thread is a note, an answer,
// a correction or a question about that task, answered from its record. The office writes back a
// receipt, the finished result and any question the team has; approvals stay in the app. Unknown aliases and senders are
// dropped and logged, never bounced.
import { RateLimiter } from '../server/ratelimit.mjs';
import { bodyText } from './inbound.mjs';
import { mailParts } from './format.mjs';
import { planProjectFrom } from '../project-planner.mjs';
import { ROOT } from '../config.mjs';
import { attachmentProblem, safeFileName, extensionOf, TEXT_EXTENSIONS } from '../channels/channel.mjs';
import { isQuestion } from '../engine/deep-agents.mjs';
import { extractDocument } from '../documents.mjs';
import { run as runContext } from '../server/request-context.mjs';
import { listWorkspaceFiles } from '../engine/documents.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const tagOf = id => String(id || '').replace(/-/g, '').slice(0, 8).toLowerCase();
export const SUBJECT_TAG = /\[AO-([a-z0-9]{8})\]/i;
export const cleanSubject = s => String(s || '').replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, '').replace(SUBJECT_TAG, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Email task';
const NOTICE_KINDS = new Set(['question', 'escalated', 'ceo_decision', 'ceo_approval']);

// `mail` is { mailer, domain } read at call time, so a change in the Platform panel applies at once.
export function createIntake({ accounts, registry, mail = { mailer: null, domain: '' }, publicOrigin = () => '', log = console.log }) {
  const mailer = () => mail.mailer, domain = () => mail.domain || '';
  const limiter = new RateLimiter({ max: 30, windowMs: 3600000 });
  const watched = new WeakSet();
  const link = id => `${publicOrigin()}/#task=${id}`;
  // The requester is a member of this office, so every message opens with their name rather than a bare "Hello".
  const greetingFor = viewer => { const first = String(viewer?.name || '').trim().split(/\s+/)[0]; return first ? `Hello ${first},` : 'Hello,'; };
  const viewerOf = (tenantId, userId) => { const m = accounts.membership(userId, tenantId); return m && { id: m.id, email: m.email, name: m.name, role: m.role, tenantId, groups: accounts.groupsOf(userId, tenantId) }; };
  const aliasFor = (tenant, userId, jobId = null) => { const h = accounts.mailHandleFor(userId, tenant.id); return h && domain() ? `${tenant.slug}.${h.handle}.${h.suffix}${jobId ? '+' + tagOf(jobId) : ''}@${domain()}` : null; };
  const drop = (m, reason, detail = {}) => { accounts.mailLog({ level: 'warn', summary: `Dropped mail: ${reason}`, detail: { from: m.from?.address, to: m.recipients, subject: String(m.subject || '').slice(0, 120), ...detail } }); log(`  mail: dropped (${reason}) from ${m.from?.address || '?'}`); return { outcome: 'dropped', reason }; };

  // The task an incoming message belongs to: the +tag of the alias, then the mail thread, then the [AO-…] tag in the subject.
  function threadOf(instance, tenantId, m, tag) {
    const byTag = t => { if (!t) return null; const w = String(t).toLowerCase(); return instance.engine.list().find(j => tagOf(j.id) === w)?.id || null; };
    const tagged = byTag(tag) || byTag(m.mailboxHash); if (tagged) return tagged;
    const found = accounts.findThread([m.inReplyTo, ...(m.references || [])]); if (found && found.tenantId === tenantId && instance.engine.get(found.jobId)) return found.jobId;
    return byTag(SUBJECT_TAG.exec(m.subject || '')?.[1]);
  }
  // A mail back on the thread of a task (or of a question): threaded, with the alias as Reply-To so a reply lands on the same task.
  async function sendOnThread(instance, tenant, viewer, jobId, { to, subject, text, inReplyTo = null, references = [], attachments = [] }) {
    if (!mailer()?.enabled) return null;
    const known = jobId ? accounts.threadMessageIds(jobId) : [];
    // Agents write Markdown; a mail client shows that literally. Both parts are built from the same text.
    const parts = mailParts(text, { greeting: greetingFor(viewer), signature: instance.name, footer: jobId ? 'Reply to this email to add a note to the task.' : '' });
    const result = await mailer().send({ to, subject, text: parts.text, html: parts.html, replyTo: aliasFor(tenant, viewer.id, jobId), inReplyTo: inReplyTo || known.at(-1) || null, references: [...known, ...references], attachments, tag: jobId ? tagOf(jobId) : '' });
    accounts.recordMailMessage({ tenantId: tenant.id, jobId, direction: 'out', messageId: result.messageId, providerId: result.id });
    return result;
  }
  const receivedFiles = (attached, skipped) => [attached.length ? `Files received: ${attached.join(', ')}.` : '', skipped.length ? `Not taken: ${skipped.map(f => `${f.name} (${f.problem})`).join('; ')}.` : ''].filter(Boolean).join('\n');

  /** One inbound message, end to end. Returns { outcome, jobId?, reason? }; never throws for a bad message, only for a broken office. */
  async function handle(m) {
    const hit = (m.recipients || []).map(r => ({ r, a: accounts.resolveAlias(String(r).split('@')[0]) })).find(x => x.a && (!domain() || String(x.r).toLowerCase().endsWith('@' + domain().toLowerCase())));
    if (!hit) return drop(m, 'unknown alias');
    const { tenantId, userId, tag } = hit.a, tenant = accounts.tenant(tenantId);
    if (!tenant || tenant.suspendedAt) return drop(m, 'office suspended');
    if (Object.values(m.auth || {}).some(v => v === 'fail')) return drop(m, 'sender authentication failed', { auth: m.auth });
    const instance = await registry.get(tenantId);
    if (!accounts.isSenderAllowed(userId, tenantId, m.from?.address)) { instance.audit.record({ area: 'mail', actor: 'mail', summary: `Dropped mail from ${m.from?.address || '?'} to ${hit.r}: the sender is not verified for this alias` }); return drop(m, 'sender not verified', { alias: hit.r }); }
    if (!limiter.hit(`${tenantId}:${userId}`)) return drop(m, 'too many messages this hour', { alias: hit.r });
    const viewer = viewerOf(tenantId, userId); if (!viewer) return drop(m, 'not a member');
    if (m.messageId) accounts.recordMailMessage({ tenantId, jobId: null, direction: 'in', messageId: m.messageId, providerId: m.providerMessageId });
    const jobId = threadOf(instance, tenantId, m, tag);
    return runContext({ user: viewer, tenantId, instance }, () => jobId ? onThread(instance, tenant, viewer, jobId, m) : fresh(instance, tenant, viewer, m));
  }

  // "Project: <name>" with a name the office does not know yet: the Program Manager plans the whole project from the
  // body and the attachments, exactly as the Projects form does. A short brief, no model or a refusal is answered on
  // the thread rather than dropped, because the sender is waiting for something.
  async function planProjectByMail(instance, tenant, viewer, m, { name, text, good, skipped }) {
    const { projects, engine, knowledge, models, office } = instance;
    const brief = [name, text].filter(Boolean).join('\n\n');
    const say = body => sendOnThread(instance, tenant, viewer, null, { to: m.from.address, subject: `Re: ${m.subject || name}`, text: body, inReplyTo: m.messageId, references: m.references });
    if (brief.trim().length < 10) { await say(`Say what “${name}” should build or achieve, in a sentence or two at least, and send it again.`); return { outcome: 'refused', reason: 'project brief too short' }; }
    if (!models.ready()) { await say(`“${name}” cannot be planned yet: the office has no model ready. Send it again once the platform has one.`); return { outcome: 'refused', reason: 'no model ready' }; }
    const documents = [];
    for (const f of good.slice(0, 10)) {
      try { documents.push(await extractDocument({ name: f.name, data: f.bytes.toString('base64') })); }
      catch (error) { log(`  mail: could not read ${f.name} for the project: ${error.message}`); }
    }
    let planned;
    try { planned = await planProjectFrom({ brief, documents, office, models, projects, engine, knowledge, agency: instance.agency, ownerId: viewer.id, audience: { visibility: 'private' }, root: ROOT, log }); }
    catch (error) { await say(`The office could not plan “${name}”: ${error.message}`); return { outcome: 'refused', reason: error.message }; }
    const p = planned.project;
    instance.syncProject?.(p.id);
    if (m.messageId) accounts.recordMailMessage({ tenantId: tenant.id, jobId: null, direction: 'in', messageId: m.messageId, providerId: m.providerMessageId });
    instance.audit.record({ area: 'mail', actor: viewer.email, summary: `Planned project “${p.name}” from an email by ${m.from.address}: ${p.milestones.length} milestone${p.milestones.length === 1 ? '' : 's'}, ${planned.tasks.length} task${planned.tasks.length === 1 ? '' : 's'}` });
    await say([`Planned. “${p.name}” is on the board.`,
      p.purpose ? `Purpose: ${p.purpose}` : '',
      p.milestones.length ? `Milestones: ${p.milestones.map(ms => ms.title).join(', ')}` : '',
      planned.tasks.length ? `Starting with: ${planned.tasks.map(t => t.title).join('; ')}` : '',
      `Open it under Projects: ${publicOrigin()}/#/settings/projects`,
      receivedFiles(documents.map(d => d.name), skipped)].filter(Boolean).join('\n\n'));
    return { outcome: 'project', projectId: p.id };
  }

  async function fresh(instance, tenant, viewer, m) {
    const text = bodyText(m), title = cleanSubject(m.subject), { engine, knowledge } = instance;
    const files = (m.attachments || []).map(a => ({ ...a, name: safeFileName(a.name) || String(a.name || 'file'), problem: attachmentProblem(a) }));
    const good = files.filter(f => !f.problem), skipped = files.filter(f => f.problem);
    if (!text && !good.length) return drop(m, 'empty message');
    // "Project: <name>" in the subject: work for a project the office already has, or a new one to plan. The name must
    // match a project exactly (case aside); anything else is a new project, and the receipt says which happened.
    const asProject = /^project\s*:\s*(.+)$/i.exec(title);
    let project = null;
    if (asProject) {
      const wanted = asProject[1].trim();
      project = instance.projects.list().find(p => String(p.name).trim().toLowerCase() === wanted.toLowerCase()) || null;
      if (project?.status === 'archived') {
        await sendOnThread(instance, tenant, viewer, null, { to: m.from.address, subject: `Re: ${m.subject || wanted}`, inReplyTo: m.messageId, references: m.references,
          text: `“${project.name}” is archived, so it takes no new work. Reopen it under Settings → Projects and send this again.` });
        return { outcome: 'refused', reason: 'project archived' };
      }
      if (!project) return planProjectByMail(instance, tenant, viewer, m, { name: wanted, text, good, skipped });
    }
    // A question is work like any other and goes through triage: a lookup lands in the quick lane, where the lead has
    // the Brain search, the workspace, export_pdf and export_pptx and the read-only Vault, and the office mails the
    // answer back with whatever it produced. Answering from a single untooled model call could not read a note, so it
    // guessed. Only a question about a task already under way is still answered from that task's record.
    const long = text.length > 12000, ready = instance.models.ready();
    const asked = long ? text.slice(0, 11000) + '\n\n(The message is long: the whole of it is attached as /work/inbox/message.md.)' : text || `Files received by email from ${m.from.address}: ${good.map(f => f.name).join(', ')}. Read them under /work/inbox/ and do what they ask.`;
    // The answer goes back by email, so the deliverable has to be something a mail client can open on a phone.
    const brief = `${asked}\n\nThis came in by email and the answer is emailed back, so the answer belongs in the message itself: write it as the reply, however long it runs, and do not put it in a file. Make a file only when a report, a document or a deck was actually asked for, and then it leaves as a PDF: write the Markdown and call export_pdf (export_pptx for slides). A Markdown file is never emailed, because it cannot be read on a phone.`;
    // Added to a project the subject names the project, so the work takes its title from the message itself.
    const workTitle = project ? (text.split('\n').map(s => s.trim()).find(Boolean) || `Work for ${project.name}`).slice(0, 100) : title;
    const job = engine.create({ dept: 'auto', depts: 'auto', text: brief, title: workTitle, projectId: project?.id || null, ownerId: viewer.id, visibility: 'private', autoStart: false, backlog: !ready, origin: { channel: 'email', from: m.from.address, messageId: m.messageId || undefined, subject: String(m.subject || '').slice(0, 200) } });
    if (long) good.unshift({ name: 'message.md', contentType: 'text/markdown', bytes: Buffer.from(`# ${title}\n\nFrom: ${m.from.address}\n\n${text}\n`) });
    const attached = good.length ? engine.attach(job.id, good).attachments.map(a => a.name) : [];
    // Documents the Brain can read are filed under the member's inbox folder too, so every agent can search them.
    const handle = accounts.mailHandleFor(viewer.id, tenant.id)?.handle || viewer.id;
    for (const f of good.filter(f => TEXT_EXTENSIONS.has(extensionOf(f.name)))) {
      try { const doc = await extractDocument({ name: f.name, data: f.bytes.toString('base64') }); if (doc.content?.trim()) await knowledge.upload({ folder: `Inbox/${handle.replace(/[^A-Za-z0-9 _-]+/g, '-')}`, name: doc.name, content: doc.content }); }
      catch (error) { log(`  mail: could not read ${f.name} for the Brain: ${error.message}`); }
    }
    if (m.messageId) accounts.recordMailMessage({ tenantId: tenant.id, jobId: job.id, direction: 'in', messageId: m.messageId, providerId: m.providerMessageId });
    if (ready) engine.pump();
    instance.audit.record({ area: 'mail', actor: viewer.email, summary: `Task “${job.title}” created from an email by ${m.from.address}${attached.length ? ` with ${attached.length} file${attached.length === 1 ? '' : 's'}` : ''}` });
    await sendOnThread(instance, tenant, viewer, job.id, { to: m.from.address, subject: `Re: ${m.subject || title} [AO-${tagOf(job.id)}]`, inReplyTo: m.messageId, references: m.references,
      text: [`Received. ${ready ? 'The Program Manager is on it and will bring in the right team.' : 'It is saved as an idea: the office has no model ready yet, so it starts once the platform has one.'}`, `Task: ${job.title}${job.projectName ? ` — in project “${job.projectName}”` : ''}`, `Follow it here: ${link(job.id)}`, receivedFiles(attached, skipped)].filter(Boolean).join('\n\n') });
    return { outcome: 'task', jobId: job.id };
  }

  async function onThread(instance, tenant, viewer, jobId, m) {
    const { engine } = instance, job = engine.get(jobId), text = bodyText(m);
    if (job.ownerId && job.ownerId !== viewer.id && !['owner', 'admin'].includes(viewer.role)) return drop(m, 'the thread belongs to someone else', { jobId });
    const files = (m.attachments || []).map(a => ({ ...a, name: safeFileName(a.name) || String(a.name || 'file'), problem: attachmentProblem(a) })), good = files.filter(f => !f.problem);
    const attached = good.length ? engine.attach(jobId, good).attachments.map(a => a.name) : [];
    if (m.messageId) accounts.recordMailMessage({ tenantId: tenant.id, jobId, direction: 'in', messageId: m.messageId, providerId: m.providerMessageId });
    const mail = (subject, body) => sendOnThread(instance, tenant, viewer, jobId, { to: m.from.address, subject: `Re: ${job.title} [AO-${tagOf(jobId)}]`, inReplyTo: m.messageId, references: m.references, text: body });
    if (!text) { if (attached.length) await mail(null, `Files added to “${job.title}”: ${attached.join(', ')}.\n${link(jobId)}`); return { outcome: attached.length ? 'attached' : 'ignored', jobId }; }
    if (isQuestion(text)) { const r = await instance.chat({ agent: 'pm', text, taskId: jobId, kind: 'question', channel: 'email' }, viewer); await mail(null, r.reply); return { outcome: 'answered', jobId }; }
    let note;
    if (job.state === 'escalated') { engine.answer(jobId, text); note = 'Your answer reached the team; the task continues.'; }
    else if (job.state === 'awaiting_ceo') { note = `This task waits for your approval, which happens in the office, not by email: ${link(jobId)}`; }
    else if (job.state === 'cancelled') { note = 'This task was cancelled. Write a new email to start a new one.'; }
    else if (job.state === 'done') { engine.message(jobId, { text, kind: 'correction' }); note = 'Reopened with your correction; the team will send a new version.'; }
    else { engine.message(jobId, { text, kind: 'note' }); note = null; }
    if (note) await mail(null, `${note}${attached.length ? `\n\nFiles added: ${attached.join(', ')}.` : ''}`);
    return { outcome: 'note', jobId };
  }

  /* ---------- the office writes back: the result, and a question or decision the team needs ---------- */
  const wants = job => { if (!job?.ownerId) return false; const pref = accounts.user(job.ownerId)?.prefs?.notifyByEmail || 'mine'; return pref === 'all' || (pref === 'mine' && job.origin?.channel === 'email'); };
  const addressFor = job => job.origin?.channel === 'email' && job.origin.from ? job.origin.from : accounts.user(job.ownerId)?.email;
  async function mailResult(instance, job) {
    const tenant = accounts.tenant(instance.tenant.id), viewer = viewerOf(tenant.id, job.ownerId); if (!viewer) return;
    // The exports the task actually produced ride back with the mail. A report and a deck are both deliverables, and only
    // export_pdf and export_pptx write these formats, so nothing from the scratch workspace comes along by accident; the
    // Mailer drops anything past its cap rather than failing the send.
    const dir = instance.engine.workspaceDir(job.id);
    const EXPORTS = { '.pdf': 'application/pdf', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
    const made = listWorkspaceFiles(dir).filter(f => EXPORTS[path.extname(f.name).toLowerCase()] && !f.name.startsWith('inbox/'))
      .sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0)).slice(0, 3);
    const attachments = made.map(f => ({ name: path.basename(f.name), contentType: EXPORTS[path.extname(f.name).toLowerCase()], bytes: fs.readFileSync(path.join(dir, f.name)) }));
    // The email is the answer. Markdown is never attached — a .md file cannot be read on a phone — and the office does not
    // turn prose into a file behind the CEO's back: whatever the task wrote goes in the body, however long it runs. A
    // document is a file only because a report or a deck was asked for and the team exported one, which is caught above.
    const inline = attachments.length ? '' : String(job.result || '');
    const summary = job.resultVersions?.at(-1)?.summary || job.review?.summary || '';
    await sendOnThread(instance, tenant, viewer, job.id, { to: addressFor(job), subject: `Done: ${job.title} [AO-${tagOf(job.id)}]`, inReplyTo: job.origin?.messageId || null, attachments, text: [summary, inline, `The full result is in the office: ${link(job.id)}`, attachments.length ? `Attached: ${attachments.map(a => a.name).join(', ')}.` : ''].filter(Boolean).join('\n\n') });
  }
  async function mailNotice(instance, job, item) {
    const tenant = accounts.tenant(instance.tenant.id), viewer = viewerOf(tenant.id, job.ownerId); if (!viewer) return;
    const approval = item.kind === 'ceo_decision' || item.kind === 'ceo_approval';
    await sendOnThread(instance, tenant, viewer, job.id, { to: addressFor(job), subject: `${approval ? 'Your approval is needed' : 'Question'}: ${job.title} [AO-${tagOf(job.id)}]`, inReplyTo: job.origin?.messageId || null,
      text: approval ? `The team waits for your approval before: ${String(item.body || '').slice(0, 1500)}\n\nApprove or reject it in the office: ${link(job.id)}` : `${String(item.body || '').slice(0, 3000)}\n\nReply to this email to answer, or answer in the office: ${link(job.id)}` });
  }
  /** Listens on a loaded office for finished results and questions to mail back. Safe to call more than once per instance. */
  function watch(instance) {
    if (!instance?.tenant || watched.has(instance)) return;
    watched.add(instance);
    instance.bus.on(event => {
      (async () => {
        if (event.type === 'task.state' && event.data?.to === 'done') { const job = instance.engine.get(event.data.id); if (job && job.kind !== 'evaluation' && wants(job)) await mailResult(instance, job); }
        else if (event.type === 'notification.new' && NOTICE_KINDS.has(event.data?.kind) && event.data.jobId) { const job = instance.engine.get(event.data.jobId); if (wants(job)) await mailNotice(instance, job, event.data); }
      })().catch(error => log(`  mail: could not write back: ${error.message}`));
    });
  }
  return { handle, watch, tagOf, aliasFor };
}
