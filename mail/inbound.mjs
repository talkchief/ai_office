// Inbound mail: each provider's webhook payload reduced to one InboundMessage (channels/channel.mjs), and the check that the
// call really came from the provider. Postmark and Mailgun are implemented; SendGrid and Resend keep the same signatures.
import crypto from 'node:crypto';
import { toText } from '../engine/tools.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const addressOf = value => { const s = String(value || '').trim(); const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(s); return m ? { name: m[1].replace(/^"|"$/g, '').trim(), address: m[2].trim().toLowerCase() } : { name: '', address: s.replace(/^<|>$/g, '').toLowerCase() }; };
const listOf = value => String(value || '').split(',').map(s => addressOf(s).address).filter(Boolean);
const idsOf = value => [...String(value || '').matchAll(/<[^>]+>/g)].map(m => m[0]);
const lower = headers => Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [String(k).toLowerCase(), String(v)]));
const authOf = headers => {
  const line = headers['authentication-results'] || '', out = {};
  for (const key of ['spf', 'dkim', 'dmarc']) { const m = new RegExp(`${key}=(pass|fail|none|neutral|softfail|temperror|permerror)`, 'i').exec(line); if (m) out[key] = m[1].toLowerCase(); }
  return out;
};
// The shared secret arrives as Basic auth (postmark:<secret> in the webhook URL) or as X-AO-Webhook-Token.
export function sharedSecretOk(req, secret) {
  if (!secret) return false;
  const token = req.headers['x-ao-webhook-token']; if (token && same(token, secret)) return true;
  const basic = /^Basic (.+)$/.exec(req.headers.authorization || ''); if (!basic) return false;
  let decoded = ''; try { decoded = Buffer.from(basic[1], 'base64').toString('utf8'); } catch { return false; }
  return same(decoded.slice(decoded.indexOf(':') + 1), secret);
}

/* ---------- Postmark: inbound webhook as JSON ---------- */
export const postmark = {
  verify(req, { secret }) { return sharedSecretOk(req, secret); },
  async parse({ rawBody }) {
    let body; try { body = JSON.parse(rawBody.toString('utf8')); } catch { fail('Postmark sent something that is not JSON.'); }
    if (!body.MessageID) fail('Postmark payload without a MessageID.');
    const headers = lower(Object.fromEntries((body.Headers || []).map(h => [h.Name, h.Value])));
    const from = body.FromFull ? { name: body.FromFull.Name || '', address: String(body.FromFull.Email || '').toLowerCase() } : addressOf(body.From);
    const recipients = (body.ToFull || []).map(t => String(t.Email || '').toLowerCase()).filter(Boolean).concat(body.ToFull?.length ? [] : listOf(body.To));
    const original = String(body.OriginalRecipient || '').toLowerCase(); if (original && !recipients.includes(original)) recipients.unshift(original);
    return { channel: 'email', provider: 'postmark', providerMessageId: String(body.MessageID), messageId: headers['message-id'] || null, inReplyTo: idsOf(headers['in-reply-to'])[0] || null, references: idsOf(headers.references),
      from, recipients, mailboxHash: body.MailboxHash || body.ToFull?.find(t => t.MailboxHash)?.MailboxHash || null, subject: String(body.Subject || ''), text: String(body.TextBody || ''), html: String(body.HtmlBody || ''), strippedReply: String(body.StrippedTextReply || ''),
      headers, attachments: (body.Attachments || []).map(a => ({ name: String(a.Name || ''), contentType: String(a.ContentType || ''), bytes: Buffer.from(String(a.Content || ''), 'base64') })), auth: authOf(headers) };
  },
};

/* ---------- Mailgun: routes post multipart/form-data; the signature covers timestamp + token with the webhook signing key ---------- */
export const mailgun = {
  verify(req, { secret, form }) {
    if (sharedSecretOk(req, secret)) return true;
    const timestamp = form?.get?.('timestamp'), token = form?.get?.('token'), signature = form?.get?.('signature');
    if (!secret || !timestamp || !token || !signature) return false;
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 15 * 60) return false;
    return same(crypto.createHmac('sha256', secret).update(String(timestamp) + String(token)).digest('hex'), String(signature));
  },
  async form({ rawBody, contentType }) {
    try { return await new Response(rawBody, { headers: { 'content-type': contentType || 'application/x-www-form-urlencoded' } }).formData(); }
    catch { fail('Mailgun sent a body the office could not read as a form.'); }
  },
  async parse({ form }) {
    const get = key => { const v = form.get(key); return typeof v === 'string' ? v : ''; };
    let pairs = []; try { pairs = JSON.parse(get('message-headers') || '[]'); } catch {}
    const headers = lower(Object.fromEntries(pairs.map(([k, v]) => [k, v])));
    const messageId = get('Message-Id') || headers['message-id'] || '';
    if (!messageId && !get('token')) fail('Mailgun payload without a message id.');
    const attachments = [];
    for (const [key, value] of form.entries()) if (/^attachment-\d+$/.test(key) && typeof value !== 'string') attachments.push({ name: value.name || key, contentType: value.type || '', bytes: Buffer.from(await value.arrayBuffer()) });
    const auth = { spf: (headers['x-mailgun-spf'] || '').toLowerCase() || undefined, dkim: (headers['x-mailgun-dkim-check-result'] || '').toLowerCase() || undefined, ...authOf(headers) };
    return { channel: 'email', provider: 'mailgun', providerMessageId: messageId || get('token'), messageId: messageId || null, inReplyTo: idsOf(get('In-Reply-To') || headers['in-reply-to'])[0] || null, references: idsOf(get('References') || headers.references),
      from: addressOf(get('from') || get('sender')), recipients: listOf(get('recipient') || get('To') || headers.to), mailboxHash: null, subject: get('subject'), text: get('body-plain'), html: get('body-html'), strippedReply: get('stripped-text'),
      headers, attachments, auth };
  },
};

/* ---------- Stubs with the same signatures ---------- */
export const sendgrid = { verify(req, { secret }) { return sharedSecretOk(req, secret); }, async parse() { fail('SendGrid inbound parsing is not implemented yet.', 501); } };
export const resend = { verify(req, { secret }) { return sharedSecretOk(req, secret); }, async parse() { fail('Resend inbound parsing is not implemented yet.', 501); } };
export const PROVIDERS = { postmark, mailgun, sendgrid, resend };

/** The webhook, end to end: the provider, the secret check, the parse. Throws 401 / 400 / 501 with a sentence. */
export async function inboundFromRequest({ provider, req, rawBody, secret }) {
  const adapter = PROVIDERS[provider]; if (!adapter) fail('Unknown mail provider.', 404);
  const contentType = String(req.headers['content-type'] || '');
  const form = provider === 'mailgun' ? await mailgun.form({ rawBody, contentType }) : null;
  if (!adapter.verify(req, { secret, form })) fail('This call did not come from the mail provider.', 401);
  return adapter.parse({ rawBody, contentType, form });
}
// The body of a message as plain text, whatever the provider handed over.
export const bodyText = m => String(m.strippedReply || m.text || (m.html ? toText(m.html) : '')).trim();
