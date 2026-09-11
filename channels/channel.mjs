// The shapes every intake channel (email now, WhatsApp later) reduces a provider's webhook to, and the attachment rules they share.
// A channel adapter turns a provider payload into an InboundMessage; the intake turns that into a task, a note, an answer or a drop.
import path from 'node:path';

/**
 * @typedef {Object} InboundAttachment
 * @property {string} name          the file name as sent (basename only after `safeFileName`)
 * @property {string} contentType   the declared media type
 * @property {Buffer} bytes
 *
 * @typedef {Object} InboundMessage
 * @property {'email'|'whatsapp'} channel
 * @property {string} provider              postmark | mailgun | sendgrid | resend | meta
 * @property {string} providerMessageId     the provider's id, for idempotency
 * @property {string|null} messageId        the message's own id (Message-ID header, wamid)
 * @property {string|null} inReplyTo
 * @property {string[]} references
 * @property {{ address: string, name: string }} from
 * @property {string[]} recipients          the addresses (or numbers) the message was sent to
 * @property {string|null} mailboxHash      the +tag of the recipient alias, when the provider extracts it
 * @property {string} subject
 * @property {string} text
 * @property {string} html
 * @property {string} strippedReply         the reply without the quoted thread, when the provider extracts it
 * @property {Record<string,string>} headers  lower-cased header names
 * @property {InboundAttachment[]} attachments
 * @property {{ spf?: string, dkim?: string, dmarc?: string }} auth  pass | fail | none, as the provider reported
 */

// What may travel into a task's workspace: by extension and by declared type. A generic octet-stream is accepted when the extension is.
export const ATTACHMENT_TYPES = {
  pdf: ['application/pdf'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], csv: ['text/csv', 'text/plain', 'application/csv'], txt: ['text/plain'], md: ['text/markdown', 'text/plain', 'text/x-markdown'],
  json: ['application/json', 'text/plain'], png: ['image/png'], jpg: ['image/jpeg'], jpeg: ['image/jpeg'],
};
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const TEXT_EXTENSIONS = new Set(['pdf', 'docx', 'txt', 'md', 'csv']); // what the Brain can extract text from

// A file name the workspace accepts: the basename, letters, digits, dots, dashes, underscores and spaces; never a dotfile or empty.
export function safeFileName(name) {
  const base = path.basename(String(name || '').replace(/\\/g, '/')).replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/\s+/g, ' ').trim();
  if (!base || base.startsWith('.') || base === '_' || base.length > 120) return null;
  return base;
}
export const extensionOf = name => path.extname(String(name || '')).slice(1).toLowerCase();
// Why an attachment is refused, or null when it may come in.
export function attachmentProblem({ name, contentType = '', bytes }) {
  const safe = safeFileName(name); if (!safe) return 'the file name is not usable';
  const ext = extensionOf(safe), allowed = ATTACHMENT_TYPES[ext]; if (!allowed) return `.${ext || '?'} files are not accepted`;
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (type && type !== 'application/octet-stream' && !allowed.includes(type)) return `the declared type ${type} does not match .${ext}`;
  const size = bytes?.length ?? 0; if (!size) return 'the file is empty'; if (size > ATTACHMENT_MAX_BYTES) return 'the file is larger than 25 MB';
  return null;
}
