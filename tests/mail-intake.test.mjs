import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accounts } from '../accounts.mjs';
import { PlatformStore } from '../platform.mjs';
import { TenantRegistry } from '../tenant-registry.mjs';
import { Mailer } from '../mail/outbound.mjs';
import { createIntake } from '../mail/intake.mjs';
import { postmark } from '../mail/inbound.mjs';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { OfficeEngine } from '../engine/deep-agents.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-intake-'));
const fixture = async (over = {}) => postmark.parse({ rawBody: Buffer.from(JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'postmark-inbound.json'), 'utf8')), ...over })) });
const to = (address, hash = '') => ({ To: address, ToFull: [{ Email: address, Name: '', MailboxHash: hash }], OriginalRecipient: address, MailboxHash: hash });

test('engine.attach files under /work/inbox/ with safe, unique names, records them and tells the team', () => {
  const dir = temp(), office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  const engine = new OfficeEngine({ dataDir: dir, office, models: {}, knowledgeDir: path.join(dir, 'k') });
  try {
    const job = engine.create({ dept: 'sales', text: 'Read the files.', autoStart: false });
    const out = engine.attach(job.id, [{ name: '../brief.pdf', contentType: 'application/pdf', bytes: Buffer.from('%PDF-1.4') }, { name: 'brief.pdf', bytes: Buffer.from('second') }, { name: 'notes (v2).md', bytes: Buffer.from('# n') }]);
    assert.deepEqual(out.saved.map(s => s.name), ['brief.pdf', 'brief-2.pdf', 'notes _v2_.md']);
    assert.ok(fs.existsSync(path.join(engine.workspaceDir(job.id), 'inbox', 'brief-2.pdf')));
    assert.equal(engine.get(job.id).attachments.length, 3); assert.equal(engine.get(job.id).attachments[0].type, 'application/pdf');
    assert.ok(engine.files(job.id).some(f => f.name === 'inbox/brief.pdf'));
    assert.match(engine.brief(engine.get(job.id)), /Read the attached files under \/work\/inbox\/ before planning: brief\.pdf, brief-2\.pdf, notes _v2_\.md/);
    assert.throws(() => engine.attach(job.id, [{ name: '.env', bytes: Buffer.from('x') }]), /not usable/);
    assert.throws(() => engine.attach(job.id, [{ name: 'empty.txt', bytes: Buffer.alloc(0) }]), /empty/);
    assert.throws(() => engine.attach(job.id, [{ name: 'huge.bin', bytes: Buffer.alloc(26 * 1024 * 1024) }]), /25 MB/);
    assert.throws(() => engine.attach(job.id, []), /at least one/);
  } finally { engine.db.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

test('mail becomes work: a verified sender gets a task with its file and a threaded receipt; strangers, unknown aliases and repeats do not', async () => {
  const root = temp(), outbox = path.join(root, 'outbox.json');
  const accounts = new Accounts({ file: path.join(root, 'accounts.sqlite') }), platform = new PlatformStore({ dir: path.join(root, 'platform'), env: {} });
  const registry = new TenantRegistry({ accounts, platform, dir: path.join(root, 'tenants'), log: () => {} });
  const mailer = new Mailer({ provider: 'postmark', domain: 'check.test', dryRun: true, outbox });
  const intake = createIntake({ accounts, registry, mail: { mailer, domain: 'check.test' }, publicOrigin: () => 'https://office.test', log: () => {} });
  registry.onLoad = intake.watch;
  try {
    const owner = accounts.createUser({ email: 'dana@acme.test', name: 'Dana Q', password: 'a long enough password' });
    const tenant = accounts.createTenant({ name: 'Check Co', ownerId: owner.id });
    const alias = intake.aliasFor(tenant, owner.id);
    assert.match(alias, /^check-co\.dana\.q\.[a-z2-7]{6}@check\.test$/);
    // Unknown alias: dropped and logged, no office loaded.
    assert.equal((await intake.handle(await fixture(to('check-co.nobody.zzzzzz@check.test')))).outcome, 'dropped');
    assert.deepEqual(registry.loaded(), []); assert.match(accounts.mailLogs(1)[0].summary, /unknown alias/);
    // A stranger writing to a real alias: dropped, and the office's audit log says so.
    const stranger = await intake.handle(await fixture({ ...to(alias), From: 'x@else.test', FromFull: { Email: 'x@else.test', Name: 'X' } }));
    assert.equal(stranger.reason, 'sender not verified');
    const instance = await registry.get(tenant.id);
    assert.ok(instance.audit.list({ area: 'mail' }).some(a => /not verified/.test(a.summary)));
    // The owner's own address: a private task for the Program Manager, the PDF under /work/inbox/, the macro file refused, the Brain fed, a receipt on the thread.
    const r = await intake.handle(await fixture(to(alias)));
    assert.equal(r.outcome, 'task'); const job = instance.engine.get(r.jobId);
    assert.equal(job.title, 'Draft the spring launch brief'); assert.equal(job.ownerId, owner.id); assert.equal(job.visibility, 'private'); assert.equal(job.state, 'backlog', 'no model yet: saved as an idea');
    assert.deepEqual(job.origin, { channel: 'email', from: 'dana@acme.test', messageId: '<CAF1=abc123@mail.acme.test>', subject: 'Fwd: Draft the spring launch brief' });
    assert.deepEqual(job.attachments.map(a => a.name), ['brief.pdf', 'notes.txt']); assert.ok(fs.existsSync(path.join(instance.engine.workspaceDir(job.id), 'inbox', 'brief.pdf')));
    assert.ok(instance.knowledge.list().some(n => n.id.startsWith('Inbox/dana-q/')), 'the text file is filed under the member’s inbox folder');
    const out = JSON.parse(fs.readFileSync(outbox, 'utf8')), receipt = out.at(-1);
    assert.match(receipt.subject, /^Re: Fwd: Draft the spring launch brief \[AO-[a-z0-9]{8}\]$/); assert.equal(receipt.inReplyTo, '<CAF1=abc123@mail.acme.test>'); assert.match(receipt.text, /brief\.pdf/); assert.match(receipt.text, /macro\.xlsm \(\.xlsm files are not accepted\)/);
    assert.match(receipt.replyTo, new RegExp(`^${alias.split('@')[0].replace(/\./g, '\\.')}\\+[a-z0-9]{8}@check\\.test$`), 'the receipt’s Reply-To carries the task tag');
    assert.deepEqual(accounts.threadMessageIds(job.id), ['<CAF1=abc123@mail.acme.test>', receipt.messageId], 'the thread knows the original mail and the receipt');
    // A reply on the thread (In-Reply-To the receipt) is a note on that task; one on the +tag alias too; a mail with a file adds it.
    const reply = await intake.handle(await fixture({ ...to(alias), MessageID: 'pm-2', Subject: 'Re: Fwd: Draft the spring launch brief', TextBody: 'Also mention the budget.', Attachments: [], Headers: [{ Name: 'Message-ID', Value: '<r2@acme.test>' }, { Name: 'In-Reply-To', Value: receipt.messageId }] }));
    assert.equal(reply.outcome, 'note'); assert.equal(reply.jobId, job.id);
    assert.ok(instance.engine.threads.list(job.id).some(m => m.text === 'Also mention the budget.' && m.role === 'ceo'));
    const tagged = await intake.handle(await fixture({ ...to(receipt.replyTo, receipt.replyTo.split('+')[1].split('@')[0]), MessageID: 'pm-3', Subject: 'numbers', TextBody: '', HtmlBody: '', Headers: [], Attachments: [{ Name: 'numbers.csv', ContentType: 'text/csv', Content: Buffer.from('a,b\n1,2').toString('base64') }] }));
    assert.equal(tagged.outcome, 'attached'); assert.deepEqual(instance.engine.get(job.id).attachments.map(a => a.name), ['brief.pdf', 'notes.txt', 'numbers.csv']);
    // A question with nothing attached is answered by the Program Manager on the thread (here: no model, so the office says so), not turned into a task.
    const q = await intake.handle(await fixture({ ...to(alias), MessageID: 'pm-4', Subject: 'Question', TextBody: 'What did we deliver last week?', Attachments: [], Headers: [{ Name: 'Message-ID', Value: '<q@acme.test>' }] }));
    assert.equal(q.outcome, 'answered'); assert.match(JSON.parse(fs.readFileSync(outbox, 'utf8')).at(-1).text, /could not answer right now/);
    assert.equal(instance.engine.list().filter(j => j.origin?.channel === 'email').length, 1);
    // Idempotency lives at the webhook: the provider id is recorded once.
    assert.equal(accounts.recordInbound({ provider: 'postmark', providerMessageId: '73e6d360' }), true); assert.equal(accounts.recordInbound({ provider: 'postmark', providerMessageId: '73e6d360' }), false);
    // The office writes back when an email task finishes.
    instance.engine.update(job.id, j => { j.result = '# Brief\n\nDone.'; j.resultVersions = [{ n: 1, summary: 'The brief is ready.' }]; }); instance.engine.setState(job.id, 'done');
    await new Promise(r => setTimeout(r, 100));
    const result = JSON.parse(fs.readFileSync(outbox, 'utf8')).at(-1);
    assert.match(result.subject, /^Done: Draft the spring launch brief \[AO-/); assert.match(result.text, /The brief is ready\./); assert.deepEqual(result.attachments.map(a => a.name), ['result.md']); assert.equal(result.to[0], 'dana@acme.test');
  } finally { await registry.closeAll(); accounts.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
});
