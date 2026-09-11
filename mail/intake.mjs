// Mail becomes work. A message to a member's alias (<office>.<person>.<suffix>@domain) from a verified sender becomes a task
// for the Program Manager: subject → title, body → brief, attachments → the task's files. A question is answered on the same
// thread. A reply on a thread is a note, an answer, a correction or a question about that task. The office writes back a
// receipt, the finished result and any question the team has; approvals stay in the app. Unknown aliases and senders are
// dropped and logged, never bounced.
import { RateLimiter } from '../server/ratelimit.mjs';
import { bodyText } from './inbound.mjs';
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

export function createIntake({ accounts, registry, mailer = null, domain = '', publicOrigin = () => '', log = console.log }) {
  const limiter = new RateLimiter({ max: 30, windowMs: 3600000 });
  const watched = new WeakSet();
  const link = id => `${publicOrigin()}/#task=${id}`;
  const viewerOf = (tenantId, userId) => { const m = accounts.membership(userId, tenantId); return m && { id: m.id, email: m.email, name: m.name, role: m.role, tenantId, groups: accounts.groupsOf(userId, tenantId) }; };
  const aliasFor = (tenant, userId, jobId = null) => { const h = accounts.mailHandleFor(userId, tenant.id); return h && domain ? `${tenant.slug}.${h.handle}.${h.suffix}${jobId ? '+' + tagOf(jobId) : ''}@${domain}` : null; };
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
    if (!mailer?.enabled) return null;
    const known = jobId ? accounts.threadMessageIds(jobId) : [];
    const result = await mailer.send({ to, subject, text: `${text}\n\n— ${instance.name}${jobId ? `\nReply to this email to add a note to the task.` : ''}`, replyTo: aliasFor(tenant, viewer.id, jobId), inReplyTo: inReplyTo || known.at(-1) || null, references: [...known, ...references], attachments, tag: jobId ? tagOf(jobId) : '' });
    accounts.recordMailMessage({ tenantId: tenant.id, jobId, direction: 'out', messageId: result.messageId, providerId: result.id });
    return result;
  }
  const receivedFiles = (attached, skipped) => [attached.length ? `Files received: ${attached.join(', ')}.` : '', skipped.length ? `Not taken: ${skipped.map(f => `${f.name} (${f.problem})`).join('; ')}.` : ''].filter(Boolean).join('\n');

  /** One inbound message, end to end. Returns { outcome, jobId?, reason? }; never throws for a bad message, only for a broken office. */
  async function handle(m) {
    const hit = (m.recipients || []).map(r => ({ r, a: accounts.resolveAlias(String(r).split('@')[0]) })).find(x => x.a && (!domain || String(x.r).toLowerCase().endsWith('@' + domain.toLowerCase())));
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

  async function fresh(instance, tenant, viewer, m) {
    const text = bodyText(m), title = cleanSubject(m.subject), { engine, knowledge } = instance;
    const files = (m.attachments || []).map(a => ({ ...a, name: safeFileName(a.name) || String(a.name || 'file'), problem: attachmentProblem(a) }));
    const good = files.filter(f => !f.problem), skipped = files.filter(f => f.problem);
    if (!text && !good.length) return drop(m, 'empty message');
    // A plain question with nothing attached: the Program Manager answers from the Brain on the same thread, no task.
    if (text && isQuestion(text) && !good.length && text.length < 1200) {
      let answer; try { answer = (await instance.chat({ agent: 'pm', text }, viewer)).reply; } catch (error) { answer = `The office could not answer right now: ${error.message}`; }
      await sendOnThread(instance, tenant, viewer, null, { to: m.from.address, subject: `Re: ${m.subject || 'Your question'}`, text: answer, inReplyTo: m.messageId, references: m.references });
      instance.audit.record({ area: 'mail', actor: viewer.email, summary: `Answered a question by email from ${m.from.address}` });
      return { outcome: 'answered' };
    }
    const long = text.length > 12000, ready = instance.models.ready();
    const brief = long ? text.slice(0, 11000) + '\n\n(The message is long: the whole of it is attached as /work/inbox/message.md.)' : text || `Files received by email from ${m.from.address}: ${good.map(f => f.name).join(', ')}. Read them under /work/inbox/ and do what they ask.`;
    const job = engine.create({ dept: 'auto', depts: 'auto', text: brief, title, ownerId: viewer.id, visibility: 'private', autoStart: false, backlog: !ready, origin: { channel: 'email', from: m.from.address, messageId: m.messageId || undefined, subject: String(m.subject || '').slice(0, 200) } });
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
      text: [`Received. ${ready ? 'The Program Manager is on it and will bring in the right team.' : 'It is saved as an idea: the office has no model ready yet, so it starts once the platform has one.'}`, `Task: ${job.title}`, `Follow it here: ${link(job.id)}`, receivedFiles(attached, skipped)].filter(Boolean).join('\n\n') });
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
    if (isQuestion(text)) { const r = await instance.chat({ agent: 'pm', text, taskId: jobId, kind: 'question' }, viewer); await mail(null, r.reply); return { outcome: 'answered', jobId }; }
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
    const dir = instance.engine.workspaceDir(job.id), pdf = listWorkspaceFiles(dir).filter(f => /\.pdf$/i.test(f.name) && !f.name.startsWith('inbox/')).sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0))[0];
    const attachments = pdf ? [{ name: path.basename(pdf.name), contentType: 'application/pdf', bytes: fs.readFileSync(path.join(dir, pdf.name)) }] : job.result ? [{ name: 'result.md', contentType: 'text/markdown', bytes: Buffer.from(String(job.result)) }] : [];
    const summary = job.resultVersions?.at(-1)?.summary || job.review?.summary || '';
    await sendOnThread(instance, tenant, viewer, job.id, { to: addressFor(job), subject: `Done: ${job.title} [AO-${tagOf(job.id)}]`, inReplyTo: job.origin?.messageId || null, attachments, text: [summary, `The full result is in the office: ${link(job.id)}`, attachments.length ? `Attached: ${attachments[0].name}.` : ''].filter(Boolean).join('\n\n') });
  }
  async function mailNotice(instance, job, item) {
    const tenant = accounts.tenant(instance.tenant.id), viewer = viewerOf(tenant.id, job.ownerId); if (!viewer) return;
    const approval = item.kind === 'ceo_decision' || item.kind === 'ceo_approval';
    await sendOnThread(instance, tenant, viewer, job.id, { to: addressFor(job), subject: `${approval ? 'Your approval is needed' : 'Question'}: ${job.title} [AO-${tagOf(job.id)}]`, inReplyTo: job.origin?.messageId || null,
      text: approval ? `The team waits for your approval before: ${String(item.body || '').slice(0, 1500)}\n\nApprove or reject it in the office: ${link(job.id)}` : `${String(item.body || '').slice(0, 3000)}\n\nReply to this email to answer, or answer in the office: ${link(job.id)}` });
  }
  /** Listens on a loaded office for finished results and questions to mail back. Safe to call more than once per instance. */
  function watch(instance) {
    if (!instance?.tenant || watched.has(instance) || !mailer?.enabled) return;
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
