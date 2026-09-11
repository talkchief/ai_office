import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inboundFromRequest, postmark, mailgun, sharedSecretOk, bodyText } from '../mail/inbound.mjs';
import { Mailer } from '../mail/outbound.mjs';
import { attachmentProblem, safeFileName } from '../channels/channel.mjs';
import { cleanSubject, tagOf } from '../mail/intake.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = () => fs.readFileSync(path.join(here, 'fixtures', 'postmark-inbound.json'));
const req = headers => ({ headers });
const basic = secret => 'Basic ' + Buffer.from('postmark:' + secret).toString('base64');

test('a Postmark inbound webhook is refused without the secret and parsed into one inbound shape with it', async () => {
  await assert.rejects(inboundFromRequest({ provider: 'postmark', req: req({}), rawBody: fixture(), secret: 's3cret' }), /did not come from the mail provider/);
  await assert.rejects(inboundFromRequest({ provider: 'postmark', req: req({ authorization: basic('wrong') }), rawBody: fixture(), secret: 's3cret' }), /did not come/);
  await assert.rejects(inboundFromRequest({ provider: 'nope', req: req({}), rawBody: fixture(), secret: 's3cret' }), /Unknown mail provider/);
  const m = await inboundFromRequest({ provider: 'postmark', req: req({ authorization: basic('s3cret') }), rawBody: fixture(), secret: 's3cret' });
  assert.equal(m.provider, 'postmark'); assert.equal(m.providerMessageId, '73e6d360-66eb-11e1-8e72-a8904824019b'); assert.equal(m.messageId, '<CAF1=abc123@mail.acme.test>');
  assert.deepEqual(m.from, { name: 'Dana Q', address: 'dana@acme.test' }); assert.deepEqual(m.recipients, ['check-co.dana.q.ab23cd@check.test']);
  assert.equal(m.subject, 'Fwd: Draft the spring launch brief'); assert.match(bodyText(m), /^Please draft a one-page brief/);
  assert.deepEqual(m.auth, { spf: 'pass', dkim: 'pass', dmarc: 'pass' });
  assert.equal(m.attachments.length, 3); assert.equal(m.attachments[0].name, 'brief.pdf'); assert.ok(m.attachments[0].bytes.toString('latin1').startsWith('%PDF'));
  assert.equal(attachmentProblem(m.attachments[0]), null); assert.equal(attachmentProblem(m.attachments[1]), null); assert.match(attachmentProblem(m.attachments[2]), /\.xlsm files are not accepted/);
  assert.equal(sharedSecretOk(req({ 'x-ao-webhook-token': 's3cret' }), 's3cret'), true);
  const strippedReply = await postmark.parse({ rawBody: Buffer.from(JSON.stringify({ MessageID: 'x', From: 'Sam <sam@acme.test>', To: 'a@b.test', Subject: 'Re: thing', TextBody: 'quoted…', StrippedTextReply: 'Just the reply', Headers: [] })) });
  assert.equal(bodyText(strippedReply), 'Just the reply'); assert.deepEqual(strippedReply.from, { name: 'Sam', address: 'sam@acme.test' });
});

test('a Mailgun route posts a form: the signature is checked, the fields and files are read', async () => {
  const secret = 'signing-key', timestamp = String(Math.floor(Date.now() / 1000)), token = 'tok123';
  const signature = crypto.createHmac('sha256', secret).update(timestamp + token).digest('hex');
  const form = new FormData();
  for (const [k, v] of Object.entries({ recipient: 'check-co.dana.q.ab23cd@check.test', sender: 'dana@acme.test', from: 'Dana Q <dana@acme.test>', subject: 'Re: Numbers [AO-abcd1234]', 'body-plain': 'Here you go.\n\n> quoted', 'stripped-text': 'Here you go.', 'Message-Id': '<m2@acme.test>', 'In-Reply-To': '<ao-abcd1234-x@check.test>', 'message-headers': JSON.stringify([['X-Mailgun-Spf', 'Pass'], ['X-Mailgun-Dkim-Check-Result', 'Pass']]), timestamp, token, signature, 'attachment-count': '1' })) form.set(k, v);
  form.set('attachment-1', new Blob([Buffer.from('a,b\n1,2\n')], { type: 'text/csv' }), 'numbers.csv');
  const res = new Response(form); const rawBody = Buffer.from(await res.arrayBuffer()), contentType = res.headers.get('content-type');
  const m = await inboundFromRequest({ provider: 'mailgun', req: req({ 'content-type': contentType }), rawBody, secret });
  assert.equal(m.provider, 'mailgun'); assert.equal(m.messageId, '<m2@acme.test>'); assert.equal(m.inReplyTo, '<ao-abcd1234-x@check.test>'); assert.equal(bodyText(m), 'Here you go.');
  assert.deepEqual(m.recipients, ['check-co.dana.q.ab23cd@check.test']); assert.deepEqual(m.attachments.map(a => [a.name, a.contentType, a.bytes.toString()]), [['numbers.csv', 'text/csv', 'a,b\n1,2\n']]);
  assert.equal(m.auth.spf, 'pass'); assert.equal(m.auth.dkim, 'pass');
  form.set('signature', 'forged'); const forged = new Response(form);
  await assert.rejects(inboundFromRequest({ provider: 'mailgun', req: req({ 'content-type': forged.headers.get('content-type') }), rawBody: Buffer.from(await forged.arrayBuffer()), secret }), /did not come/);
  assert.equal(mailgun.verify(req({ 'x-ao-webhook-token': secret }), { secret, form: null }), true, 'the shared token works for Mailgun too');
});

test('file names and subjects are made safe; the dry-run mailer writes the outbox with threading headers', async () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd'); assert.equal(safeFileName('.env'), null); assert.equal(safeFileName('Q3 report (final).pdf'), 'Q3 report _final_.pdf'); assert.equal(safeFileName(''), null);
  assert.equal(cleanSubject('Re: Fwd: RE: Draft the brief [AO-abcd1234]'), 'Draft the brief'); assert.equal(cleanSubject(''), 'Email task'); assert.equal(tagOf('3f2a9c10-1234-4abc-9def-000000000000'), '3f2a9c10');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-mail-')), outbox = path.join(dir, 'mail-outbox.json');
  try {
    assert.throws(() => new Mailer({ provider: 'mailgun', apiKey: '' }), /AO_MAIL_API_KEY/);
    const mailer = new Mailer({ provider: 'postmark', domain: 'check.test', dryRun: true, outbox, now: () => 1000 });
    const r = await mailer.send({ to: 'dana@acme.test', subject: 'Re: Draft [AO-abcd1234]', text: 'Received.', replyTo: 'check-co.dana.q.ab23cd+abcd1234@check.test', inReplyTo: '<CAF1@acme.test>', attachments: [{ name: 'big.pdf', contentType: 'application/pdf', bytes: Buffer.alloc(11 * 1024 * 1024) }, { name: 'small.md', contentType: 'text/markdown', bytes: Buffer.from('# hi') }] });
    assert.ok(r.dryRun); assert.match(r.messageId, /^<ao-.+@check\.test>$/); assert.equal(r.attachments, 1, 'a file past the cap is dropped, the send goes on');
    const [saved] = JSON.parse(fs.readFileSync(outbox, 'utf8'));
    assert.equal(saved.inReplyTo, '<CAF1@acme.test>'); assert.deepEqual(saved.references, ['<CAF1@acme.test>']); assert.equal(saved.replyTo, 'check-co.dana.q.ab23cd+abcd1234@check.test'); assert.equal(saved.from, 'office@check.test'); assert.deepEqual(saved.attachments.map(a => a.name), ['small.md']);
    // The real senders build the provider's request; a fake fetch sees the headers and the body shape.
    const seen = []; const fake = async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify({ MessageID: 'pm-1', id: '<mg-1@check.test>' }), { status: 200, headers: { 'content-type': 'application/json' } }); };
    const pm = new Mailer({ provider: 'postmark', apiKey: 'pm-token', domain: 'check.test', fetchImpl: fake });
    await pm.send({ to: 'dana@acme.test', subject: 's', text: 't', inReplyTo: '<x@y>' });
    assert.equal(seen[0].url, 'https://api.postmarkapp.com/email'); assert.equal(seen[0].init.headers['x-postmark-server-token'], 'pm-token'); assert.ok(JSON.parse(seen[0].init.body).Headers.some(h => h.Name === 'In-Reply-To' && h.Value === '<x@y>'));
    const mg = new Mailer({ provider: 'mailgun', apiKey: 'key-1', domain: 'check.test', fetchImpl: fake });
    await mg.send({ to: 'dana@acme.test', subject: 's', text: 't' });
    assert.equal(seen[1].url, 'https://api.mailgun.net/v3/check.test/messages'); assert.equal(seen[1].init.headers.authorization, 'Basic ' + Buffer.from('api:key-1').toString('base64')); assert.ok(seen[1].init.body instanceof FormData); assert.equal(seen[1].init.body.get('to'), 'dana@acme.test');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
