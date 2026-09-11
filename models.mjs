// Provider registry: which chat model runs each role, from any provider LangChain can reach.
// Keys live only on the server (data/providers.json, mode 0600, or the service environment).
import fs from 'node:fs';
import path from 'node:path';

export const PROVIDER_TYPES = ['anthropic', 'openai', 'openai-compatible'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const ROLES = ['pm', 'lead', 'specialist', 'review', 'chat', 'office'];
const ENV_KEYS = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY' };
// Older office files name models by family.
export const LEGACY_MODELS = { sonnet: 'claude-sonnet-5', opus: 'claude-opus-5', fable: 'claude-fable-5-1' };
const REFUSAL_FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5']);

export const DEFAULT_REGISTRY = {
  version: 1,
  providers: [
    { id: 'anthropic', type: 'anthropic', label: 'Anthropic', enabled: true, refusalFallback: true },
    { id: 'openai', type: 'openai', label: 'OpenAI', enabled: true },
    { id: 'openrouter', type: 'openai-compatible', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', enabled: true, headers: { 'X-Title': 'Cloud AI Office' } },
  ],
  // No model is built in: the owner adds a key, then activates models from the provider's own list.
  models: [],
  roleDefaults: { pm: '', lead: '', specialist: '', review: '', chat: '', office: '' },
  roleEfforts: { pm: 'high', lead: 'high', specialist: 'medium', review: 'high', chat: 'low', office: '' },
};

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const idOk = id => /^[a-z][a-z0-9_-]{0,47}$/.test(id || '');
export const normEffort = value => EFFORTS.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : '';
export const normModel = value => { const v = text(value, 120); return LEGACY_MODELS[v.toLowerCase()] || v; };

async function defaultFactory(type, options) {
  if (type === 'anthropic') { const { ChatAnthropic } = await import('@langchain/anthropic'); return new ChatAnthropic(options); }
  const { ChatOpenAI } = await import('@langchain/openai'); return new ChatOpenAI(options);
}

// One request to a provider, streaming included: a call that produces nothing for this long is treated as failed and retried.
export const CALL_TIMEOUT_MS = 5 * 60 * 1000;

// The SDKs' timeout covers the wait for the response headers only; once a stream is open, a provider that stops sending would hold
// the call forever. This wraps fetch so that a body with no data for `ms` fails the call with a message the retry rule treats as transient.
// A request that fails before any answer comes back (a reset socket, a certificate that a web filter swapped in on this one
// connection) is tried again on a fresh connection, up to three times, when the body can be sent again.
const RETRY_NETWORK = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|certificate|TLS|EPIPE/i;
const canResend = body => body == null || typeof body === 'string' || body instanceof Uint8Array || body instanceof ArrayBuffer || (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams);
// A provider that answers 429 (rate limited) or 5xx (overloaded, down) is asked again after a pause when the body can be sent
// again: Retry-After when the provider gives one (up to a minute), else a growing pause, for about three minutes in all; then
// the last answer is handed back and the task-level retry takes over. This sits below the SDKs on purpose: LangChain treats a
// 429 without Retry-After as final and switches the OpenAI SDK's own retries off, so without it a rate-limited call fails at once.
const RETRY_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const RESEND_PAUSES = [2000, 5000, 10000, 20000, 40000, 60000, 60000];
export const RESEND_TOTAL_MS = 200000;
export function retryAfterMs(res) {
  const h = res.headers?.get?.('retry-after'); if (!h) return null;
  const s = Number(h); if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const at = Date.parse(h); return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}
const sleep = (ms, signal) => new Promise(resolve => { const done = () => { clearTimeout(t); signal?.removeEventListener?.('abort', done); resolve(); }; const t = setTimeout(done, ms); signal?.addEventListener?.('abort', done, { once: true }); });
// An error a provider reports inside a successful answer: OpenRouter accepts a streamed request and, when the upstream then
// refuses it (its rate limit arrives this way), sends a 200 whose first event is an error object; a small JSON answer can
// carry one too. The first data event is peeked (comment lines such as ": OPENROUTER PROCESSING" are skipped) and an error
// there is treated like its code; anything else is handed on untouched, the peeked bytes first.
const RETRY_MESSAGE = /rate.?limit|too many requests|overloaded|temporarily|try again|capacity|unavailable|timed? ?out|internal server error|bad gateway|upstream/i;
export const PEEK_MS = 30000;
const errorIn = data => { try { const v = JSON.parse(data); const e = v?.error; if (!e) return null; const code = Number(e.code || e.status || v.code) || 0, message = String(e.message || e || ''); return { code, message, retry: RETRY_STATUS.has(code) || RETRY_MESSAGE.test(message) }; } catch { return null; } };
async function peekAnswer(res, ms = PEEK_MS) {
  const type = String(res.headers?.get?.('content-type') || '');
  if (!res.body || res.status !== 200) return { res };
  if (/application\/json/.test(type)) { const text = await res.text(); return { res: new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers }), error: errorIn(text) }; }
  if (!/text\/event-stream/.test(type)) return { res };
  const reader = res.body.getReader(), decoder = new TextDecoder(), chunks = []; let text = '', done = false, error = null;
  const deadline = Date.now() + ms;
  while (!done && text.length < 16384) {
    let timer; const next = await Promise.race([reader.read(), new Promise(r => { timer = setTimeout(() => r({ late: true }), Math.max(1, deadline - Date.now())); })]); clearTimeout(timer);
    if (next.late) break;
    if (next.done) { done = true; break; }
    chunks.push(next.value); text += decoder.decode(next.value, { stream: true });
    const block = text.split('\n\n').find(b => /^data:/m.test(b)); if (!block) continue;
    if (!text.includes(block + '\n\n') && !done) continue;
    const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
    error = errorIn(data); break;
  }
  if (error?.retry) { try { await reader.cancel(); } catch {} return { res, error }; }
  // Hand the answer on as it was: the peeked bytes first, then the rest of the stream.
  let i = 0;
  const body = new ReadableStream({
    async pull(controller) {
      if (i < chunks.length) { controller.enqueue(chunks[i++]); return; }
      if (done) { controller.close(); return; }
      try { const next = await reader.read(); if (next.done) { done = true; controller.close(); } else controller.enqueue(next.value); } catch (e) { controller.error(e); }
    },
    cancel(reason) { return reader.cancel(reason).catch(() => {}); },
  });
  return { res: new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }), error };
}
export async function fetchWithRetries(fetchImpl, url, init, { attempts = 3, pause = 400, resend = true, total = RESEND_TOTAL_MS, pauses = RESEND_PAUSES, peekMs = PEEK_MS, onWait } = {}) {
  let netFails = 0, waits = 0, waited = 0;
  for (;;) {
    let res;
    try { res = await fetchImpl(url, init); }
    catch (error) {
      netFails++; const text = String(error?.cause?.message || error?.message || '');
      if (netFails >= attempts || !RETRY_NETWORK.test(text) || !canResend(init?.body) || init?.signal?.aborted) throw error;
      await sleep(pause * netFails, init?.signal); continue;
    }
    if (!resend || !canResend(init?.body) || init?.signal?.aborted) return res;
    let status = res.status;
    if (status === 200) { const peeked = await peekAnswer(res, peekMs); res = peeked.res; if (!peeked.error?.retry) return res; status = peeked.error.code || 503; }
    else if (!RETRY_STATUS.has(status)) return res;
    const delay = Math.min(retryAfterMs(res) ?? pauses[Math.min(waits, pauses.length - 1)], 60000);
    if (waited + delay > total) return res;
    try { await res.body?.cancel?.(); } catch {}
    waits++; waited += delay;
    try { onWait?.({ status, attempt: waits, delay, url: String(url) }); } catch {}
    await sleep(delay, init?.signal);
    if (init?.signal?.aborted) throw init.signal.reason || new Error('The call was stopped while waiting for the provider.');
  }
}
export function silenceGuard(fetchImpl, ms = CALL_TIMEOUT_MS, { onWait } = {}) {
  return async (url, init) => {
    const res = await fetchWithRetries(fetchImpl, url, init, { onWait });
    if (!res.ok || !res.body) return res;
    const reader = res.body.getReader();
    let timer = null;
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const next = await Promise.race([reader.read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`The model stream timed out: no data for ${Math.round(ms / 60000) || 1} minutes.`)), ms); })]);
          clearTimeout(timer);
          if (next.done) controller.close(); else controller.enqueue(next.value);
        } catch (error) { clearTimeout(timer); reader.cancel(error).catch(() => {}); controller.error(error); }
      },
      cancel(reason) { clearTimeout(timer); return reader.cancel(reason).catch(() => {}); },
    });
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}
export class ModelRegistry {
  constructor({ dataDir, env = process.env, factory = defaultFactory, fetchImpl = globalThis.fetch }) {
    this.file = path.join(dataDir, 'providers.json'); this.env = env; this.factory = factory; this.fetch = fetchImpl; this.modelCache = new Map();
    // Told each time a call waits for a rate-limited or overloaded provider (the engine counts these for the health page).
    this.onWait = null;
    fs.mkdirSync(dataDir, { recursive: true });
    this.value = this.validate(fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : structuredClone(DEFAULT_REGISTRY), null);
  }
  persist() { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2), { mode: 0o600 }); fs.renameSync(tmp, this.file); }
  validate(input, previous) {
    const providers = (Array.isArray(input?.providers) ? input.providers : []).slice(0, 20).map(p => {
      if (!idOk(p.id)) fail('Each provider needs an ID of lower-case letters, numbers and dashes.');
      if (!PROVIDER_TYPES.includes(p.type)) fail('Choose Anthropic, OpenAI or an OpenAI-compatible endpoint.');
      const before = previous?.providers.find(x => x.id === p.id);
      let baseURL = text(p.baseURL, 500);
      if (baseURL) { let url; try { url = new URL(baseURL); } catch { fail(`${p.id}: enter a valid base URL.`); } if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail(`${p.id}: use an HTTP(S) base URL without credentials.`); baseURL = url.href.replace(/\/$/, ''); }
      if (p.type === 'openai-compatible' && !baseURL) fail(`${p.id}: an OpenAI-compatible provider needs a base URL.`);
      // A key is write-only: a blank field keeps the stored key; clearKey removes it.
      let apiKey = p.clearKey ? '' : typeof p.apiKey === 'string' && p.apiKey.trim() ? p.apiKey.trim() : before?.apiKey || '';
      if (/[\r\n]/.test(apiKey) || apiKey.length > 8192) fail(`${p.id}: invalid key.`);
      const headers = Object.fromEntries(Object.entries(p.headers && typeof p.headers === 'object' ? p.headers : {}).slice(0, 10).map(([k, v]) => [text(k, 100), text(v, 500)]).filter(([k]) => /^[A-Za-z0-9-]+$/.test(k)));
      return { id: p.id, type: p.type, label: text(p.label, 80) || p.id, ...(baseURL ? { baseURL } : {}), apiKey, headers, enabled: p.enabled !== false, ...(p.type === 'anthropic' ? { refusalFallback: p.refusalFallback !== false } : {}) };
    });
    const ids = new Set(providers.map(p => p.id)); if (ids.size !== providers.length) fail('Provider IDs must be unique.');
    const seen = new Set();
    const models = (Array.isArray(input?.models) ? input.models : []).slice(0, 200).map(m => {
      const id = text(m.id, 120); if (!id || seen.has(id)) fail('Each model needs a unique ID.'); seen.add(id);
      if (!ids.has(m.provider)) fail(`${id}: choose an existing provider.`);
      const s = m.supports || {};
      return { id, provider: m.provider, label: text(m.label, 80) || id, enabled: m.enabled !== false, supports: { effort: !!s.effort, reasoning: !!s.reasoning, tools: s.tools !== false } };
    });
    const known = new Set(models.map(m => m.id));
    const roleDefaults = {}, roleEfforts = {};
    for (const role of ROLES) {
      const wanted = normModel(input?.roleDefaults?.[role]);
      roleDefaults[role] = known.has(wanted) ? wanted : (role === 'office' ? models[0]?.id || '' : '');
      roleEfforts[role] = input?.roleEfforts?.[role] === '' ? '' : normEffort(input?.roleEfforts?.[role]) || DEFAULT_REGISTRY.roleEfforts[role];
    }
    const embeddings = input?.embeddings && typeof input.embeddings === 'object' ? { provider: ids.has(input.embeddings.provider) ? input.embeddings.provider : '', model: text(input.embeddings.model, 120) } : { provider: '', model: '' };
    return { version: 1, providers, models, roleDefaults, roleEfforts, embeddings };
  }
  keyFor(provider) {
    if (provider.apiKey) return { key: provider.apiKey, source: 'file' };
    const envName = ENV_KEYS[provider.id] || ENV_KEYS[provider.type];
    return this.env[envName] ? { key: this.env[envName], source: 'env' } : { key: '', source: '' };
  }
  provider(id) { return this.value.providers.find(p => p.id === id); }
  model(id) { return this.value.models.find(m => m.id === normModel(id)); }
  usable(provider) { return !!provider?.enabled && (!!this.keyFor(provider).key || (provider.type === 'openai-compatible' && !!provider.baseURL && /^http:\/\/(localhost|127\.0\.0\.1)/.test(provider.baseURL))); }
  ready() { return this.value.providers.some(p => this.usable(p) && this.value.models.some(m => m.provider === p.id && m.enabled !== false)); }
  // What the browser may see: never a key.
  summary() {
    return { providers: this.value.providers.map(provider => { const { apiKey, ...p } = provider; const k = this.keyFor(provider); return { ...p, hasKey: !!k.key, keySource: k.source, usable: this.usable(provider) }; }),
      models: this.value.models, roleDefaults: this.value.roleDefaults, roleEfforts: this.value.roleEfforts, embeddings: this.value.embeddings, ready: this.ready() };
  }
  update(input) { this.value = this.validate(input, this.value); this.persist(); this.modelCache.clear(); return this.summary(); }
  // Precedence: task > routine > agent > team > role default > office default. Empty values fall through.
  resolve({ task, routine, agent, team, role = 'office' } = {}) {
    const teamRole = team?.models?.[role] || '';
    const chain = [['task', task?.model], ['routine', routine?.model], ['agent', agent?.model], ['team', teamRole], ['role', this.value.roleDefaults[role]], ['office', this.value.roleDefaults.office]];
    // Prefer the first level whose model can actually run (enabled, provider has a key); otherwise name the first configured one,
    // so the error says which key is missing instead of one stale override stopping the whole team.
    let model = '', from = '';
    for (const strict of [true, false]) {
      for (const [where, value] of chain) { const id = normModel(value), m = id && this.model(id); if (m && m.enabled !== false && (!strict || this.usable(this.provider(m.provider)))) { model = id; from = where; break; } }
      if (model) break;
    }
    const efforts = [['task', task?.effort], ['routine', routine?.effort], ['agent', agent?.effort], ['team', team?.efforts?.[role]], ['role', this.value.roleEfforts[role]], ['office', this.value.roleEfforts.office]];
    let effort = '', effortFrom = '';
    for (const [where, value] of efforts) { const e = normEffort(value); if (e) { effort = e; effortFrom = where; break; } }
    return { model, from, effort, effortFrom };
  }
  options({ model: id, effort, streaming = true, maxTokens }) {
    const model = this.model(id); if (!model) fail(`The model “${id}” is not configured. Choose one in Settings → Models.`, 409);
    const provider = this.provider(model.provider); if (!this.usable(provider)) fail(`Add a key for ${provider?.label || model.provider} in Settings → Models.`, 409);
    const { key } = this.keyFor(provider);
    if (provider.type === 'anthropic') {
      const options = { model: model.id, apiKey: key, maxTokens: maxTokens || 64000, streaming, clientOptions: { timeout: CALL_TIMEOUT_MS, fetch: silenceGuard(this.fetch, CALL_TIMEOUT_MS, { onWait: info => this.onWait?.(info) }), ...(provider.baseURL ? { baseURL: provider.baseURL } : {}) } };
      if (model.supports.effort) { options.thinking = { type: 'adaptive' }; if (effort) options.outputConfig = { effort }; }
      // Refusal fallbacks are opt-out per provider; they only apply to models that support them.
      if (provider.refusalFallback && REFUSAL_FALLBACK_MODELS.has(model.id)) { options.betas = ['server-side-fallback-2026-07-01']; options.invocationKwargs = { fallbacks: 'default' }; }
      return { type: 'anthropic', options };
    }
    const reasoningEffort = effort ? (['xhigh', 'max'].includes(effort) ? 'high' : effort) : '';
    const options = { model: model.id, apiKey: key || 'not-needed', streaming, streamUsage: true, timeout: CALL_TIMEOUT_MS, ...(maxTokens ? { maxTokens } : {}),
      configuration: { fetch: silenceGuard(this.fetch, CALL_TIMEOUT_MS, { onWait: info => this.onWait?.(info) }), ...(provider.baseURL ? { baseURL: provider.baseURL } : {}), ...(Object.keys(provider.headers || {}).length ? { defaultHeaders: provider.headers } : {}) } };
    if (reasoningEffort && (provider.type === 'openai' || model.supports.reasoning)) options.reasoning = { effort: reasoningEffort };
    return { type: 'openai', options };
  }
  async instance(spec) { const { type, options } = this.options(spec); return this.factory(type, options); }
  async test(id) {
    const provider = this.provider(id); if (!provider) fail('No such provider.', 404);
    // Test the model the office actually runs on for this provider, else the first one registered.
    const usable = m => m.provider === id && m.enabled !== false, byId = mid => this.value.models.find(m => m.id === mid && usable(m));
    const model = ['office', 'pm', 'lead', 'specialist', 'review', 'chat'].map(r => byId(this.value.roleDefaults?.[r])).find(Boolean) || this.value.models.find(usable);
    if (!this.usable(provider)) return { ok: false, model: model?.id || '', error: 'Add a key first.' };
    const started = Date.now();
    // With no model activated yet, the key is checked by listing the provider's models.
    if (!model) { try { const list = await this.listModels(id); return { ok: true, model: '', models: list.length, ms: Date.now() - started }; } catch (error) { return { ok: false, model: '', error: String(error.message || error).slice(0, 500) }; } }
    try { const chat = await this.instance({ model: model.id, streaming: false, maxTokens: 16 }); await chat.invoke('Reply with the word ready.'); return { ok: true, model: model.id, ms: Date.now() - started }; }
    catch (error) { return { ok: false, model: model.id, error: String(error.message || error).slice(0, 500) }; }
  }
  async listModels(id) {
    const provider = this.provider(id); if (!provider) fail('No such provider.', 404);
    const cached = this.modelCache.get(id); if (cached && Date.now() - cached.at < 600000) return cached.list;
    const { key } = this.keyFor(provider);
    const base = provider.type === 'anthropic' ? (provider.baseURL || 'https://api.anthropic.com') + '/v1' : provider.type === 'openai' ? (provider.baseURL || 'https://api.openai.com/v1') : provider.baseURL;
    const headers = provider.type === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { ...(key ? { authorization: 'Bearer ' + key } : {}), ...(provider.headers || {}) };
    // On some machines a connection to the provider is intercepted now and then (a web filter answering with its own certificate)
    // while the next connection is fine, so the list is asked for up to four times, on fresh connections, before giving up with the reason.
    let res, last;
    for (let attempt = 0; attempt < 4 && !res; attempt++) {
      try { res = await fetchWithRetries(this.fetch, base + '/models' + (attempt ? '?office=' + Date.now() : ''), { headers, signal: AbortSignal.timeout(15000) }, { attempts: 1, resend: false }); }
      catch (error) { last = error; }
    }
    if (!res) fail(`Could not fetch ${provider.label}’s model list (${last?.cause?.message || last?.message || 'no answer'}). Type the model id instead; it is used as typed.`, 502);
    if (!res.ok) fail(`${provider.label} returned ${res.status} when listing models.`, 502);
    const body = await res.json();
    const list = (body.data || []).map(m => ({ id: m.id, label: m.display_name || m.name || m.id, supports: { effort: provider.type === 'anthropic' && /claude-(opus|sonnet|fable)-(4\.[6-9]|[5-9])/.test(m.id), reasoning: provider.type !== 'anthropic' && (Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('reasoning') : /o[1-9]|gpt-5|reasoning|thinking|glm-[5-9]|kimi-k[3-9]|deepseek-r/i.test(m.id)) } })).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 2000);
    this.modelCache.set(id, { at: Date.now(), list }); return list;
  }
}
