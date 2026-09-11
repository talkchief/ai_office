// Outbound mail: receipts, results and questions back to the person who wrote in. Postmark or Mailgun; a dry run writes
// every message to an outbox file instead of sending (the check loop reads it). Threading headers travel with each message.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fetchWithRetries } from '../models.mjs';

const fail = (message, status = 502) => { throw Object.assign(new Error(message), { status }); };
export const ATTACHMENT_CAP = 10 * 1024 * 1024;

export class Mailer {
  constructor({ provider = 'postmark', apiKey = '', domain = '', from = '', replyTo = '', dryRun = false, outbox = null, region = 'us', fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    Object.assign(this, { provider, apiKey, domain, from: from || (domain ? `office@${domain}` : ''), replyTo, dryRun: !!dryRun, outbox, region, fetch: fetchImpl, now });
    if (!this.dryRun && !this.apiKey) fail('No mail API key: set AO_MAIL_API_KEY, or AO_MAIL_DRY_RUN=1.', 503);
  }
  get enabled() { return this.dryRun || !!this.apiKey; }
  newMessageId(tag = '') { return `<ao-${tag ? tag + '-' : ''}${crypto.randomBytes(9).toString('base64url')}@${this.domain || 'office.local'}>`; }
  /** Sends one message. `attachments` are [{ name, contentType, bytes }] and are dropped past the cap, never fail the send. */
  async send({ to, subject, text, html = '', replyTo = this.replyTo, messageId = this.newMessageId(), inReplyTo = null, references = [], attachments = [], tag = '' }) {
    const recipients = [].concat(to).filter(Boolean); if (!recipients.length) fail('No recipient.', 400);
    let total = 0; const files = [];
    for (const a of attachments) { if (!a?.bytes?.length) continue; if (total + a.bytes.length > ATTACHMENT_CAP) continue; total += a.bytes.length; files.push(a); }
    const message = { from: this.from, to: recipients, subject: String(subject || '').slice(0, 250), text: String(text || ''), html: String(html || ''), replyTo: replyTo || undefined, messageId, inReplyTo: inReplyTo || undefined, references: [...new Set([...(references || []), ...(inReplyTo ? [inReplyTo] : [])])], attachments: files.map(f => ({ name: f.name, contentType: f.contentType || 'application/octet-stream', size: f.bytes.length })), tag, at: this.now() };
    if (this.dryRun) { this.record(message); return { id: 'dry-' + crypto.randomBytes(6).toString('hex'), messageId, dryRun: true, attachments: files.length }; }
    const sent = this.provider === 'mailgun' ? await this.sendMailgun(message, files) : await this.sendPostmark(message, files);
    return { ...sent, messageId, attachments: files.length };
  }
  record(message) {
    if (!this.outbox) return;
    let list = []; try { list = JSON.parse(fs.readFileSync(this.outbox, 'utf8')); } catch {}
    list.push(message); if (list.length > 500) list = list.slice(-500);
    fs.mkdirSync(path.dirname(this.outbox), { recursive: true }); fs.writeFileSync(this.outbox, JSON.stringify(list, null, 2));
  }
  async sendPostmark(m, files) {
    const headers = [{ Name: 'Message-ID', Value: m.messageId }, ...(m.inReplyTo ? [{ Name: 'In-Reply-To', Value: m.inReplyTo }] : []), ...(m.references.length ? [{ Name: 'References', Value: m.references.join(' ') }] : [])];
    const body = { From: m.from, To: m.to.join(','), Subject: m.subject, TextBody: m.text, ...(m.html ? { HtmlBody: m.html } : {}), ...(m.replyTo ? { ReplyTo: m.replyTo } : {}), Headers: headers, MessageStream: 'outbound', Attachments: files.map(f => ({ Name: f.name, ContentType: f.contentType || 'application/octet-stream', Content: f.bytes.toString('base64') })) };
    const res = await fetchWithRetries(this.fetch, 'https://api.postmarkapp.com/email', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'x-postmark-server-token': this.apiKey }, body: JSON.stringify(body) }, { resend: false });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.ErrorCode) fail(`Postmark refused the message: ${out.Message || res.status}`);
    return { id: out.MessageID };
  }
  async sendMailgun(m, files) {
    const form = new FormData();
    form.set('from', m.from); for (const r of m.to) form.append('to', r); form.set('subject', m.subject); form.set('text', m.text); if (m.html) form.set('html', m.html);
    if (m.replyTo) form.set('h:Reply-To', m.replyTo); form.set('h:Message-Id', m.messageId); if (m.inReplyTo) form.set('h:In-Reply-To', m.inReplyTo); if (m.references.length) form.set('h:References', m.references.join(' '));
    for (const f of files) form.append('attachment', new Blob([f.bytes], { type: f.contentType || 'application/octet-stream' }), f.name);
    const host = this.region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
    const res = await fetchWithRetries(this.fetch, `${host}/v3/${this.domain}/messages`, { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from('api:' + this.apiKey).toString('base64') }, body: form }, { resend: false });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) fail(`Mailgun refused the message: ${out.message || res.status}`);
    return { id: out.id };
  }
}

/** The mailer the server runs with, from the environment; null when mail is not configured at all. */
export function mailerFromEnv(env = process.env, { outbox = null } = {}) {
  const provider = String(env.AO_MAIL_PROVIDER || 'postmark').toLowerCase(), dryRun = env.AO_MAIL_DRY_RUN === '1';
  if (!dryRun && !env.AO_MAIL_API_KEY) return null;
  return new Mailer({ provider, apiKey: env.AO_MAIL_API_KEY || '', domain: env.AO_MAIL_DOMAIN || '', from: env.AO_MAIL_FROM || '', dryRun, outbox: dryRun ? outbox || 'mail-outbox.json' : null, region: env.AO_MAIL_REGION || 'us' });
}
