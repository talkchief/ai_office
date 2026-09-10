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
    { id: 'openrouter', type: 'openai-compatible', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', enabled: true, headers: { 'X-Title': 'Talkchief AI Space' } },
  ],
  models: [
    { id: 'claude-opus-5', provider: 'anthropic', label: 'Claude Opus 5', supports: { effort: true } },
    { id: 'claude-sonnet-5', provider: 'anthropic', label: 'Claude Sonnet 5', supports: { effort: true } },
    { id: 'claude-fable-5-1', provider: 'anthropic', label: 'Claude Fable 5.1', supports: { effort: true } },
    { id: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku 4.5', supports: { effort: false } },
  ],
  roleDefaults: { pm: 'claude-opus-5', lead: 'claude-sonnet-5', specialist: 'claude-sonnet-5', review: 'claude-sonnet-5', chat: 'claude-sonnet-5', office: 'claude-sonnet-5' },
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

export class ModelRegistry {
  constructor({ dataDir, env = process.env, factory = defaultFactory, fetchImpl = globalThis.fetch }) {
    this.file = path.join(dataDir, 'providers.json'); this.env = env; this.factory = factory; this.fetch = fetchImpl; this.modelCache = new Map();
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
      roleDefaults[role] = known.has(wanted) ? wanted : (known.has(DEFAULT_REGISTRY.roleDefaults[role]) ? DEFAULT_REGISTRY.roleDefaults[role] : models[0]?.id || '');
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
      const options = { model: model.id, apiKey: key, maxTokens: maxTokens || 64000, streaming, ...(provider.baseURL ? { clientOptions: { baseURL: provider.baseURL } } : {}) };
      if (model.supports.effort) { options.thinking = { type: 'adaptive' }; if (effort) options.outputConfig = { effort }; }
      // Refusal fallbacks are opt-out per provider; they only apply to models that support them.
      if (provider.refusalFallback && REFUSAL_FALLBACK_MODELS.has(model.id)) { options.betas = ['server-side-fallback-2026-07-01']; options.invocationKwargs = { fallbacks: 'default' }; }
      return { type: 'anthropic', options };
    }
    const reasoningEffort = effort ? (['xhigh', 'max'].includes(effort) ? 'high' : effort) : '';
    const options = { model: model.id, apiKey: key || 'not-needed', streaming, streamUsage: true, ...(maxTokens ? { maxTokens } : {}),
      configuration: { ...(provider.baseURL ? { baseURL: provider.baseURL } : {}), ...(Object.keys(provider.headers || {}).length ? { defaultHeaders: provider.headers } : {}) } };
    if (reasoningEffort && (provider.type === 'openai' || model.supports.reasoning)) options.reasoning = { effort: reasoningEffort };
    return { type: 'openai', options };
  }
  async instance(spec) { const { type, options } = this.options(spec); return this.factory(type, options); }
  async test(id) {
    const provider = this.provider(id); if (!provider) fail('No such provider.', 404);
    // Test the model the office actually runs on for this provider, else the first one registered.
    const usable = m => m.provider === id && m.enabled !== false, byId = mid => this.value.models.find(m => m.id === mid && usable(m));
    const model = ['office', 'pm', 'lead', 'specialist', 'review', 'chat'].map(r => byId(this.value.roleDefaults?.[r])).find(Boolean) || this.value.models.find(usable); if (!model) fail('Add a model for this provider first.');
    const started = Date.now();
    try { const chat = await this.instance({ model: model.id, streaming: false, maxTokens: 16 }); await chat.invoke('Reply with the word ready.'); return { ok: true, model: model.id, ms: Date.now() - started }; }
    catch (error) { return { ok: false, model: model.id, error: String(error.message || error).slice(0, 500) }; }
  }
  async listModels(id) {
    const provider = this.provider(id); if (!provider) fail('No such provider.', 404);
    const cached = this.modelCache.get(id); if (cached && Date.now() - cached.at < 600000) return cached.list;
    const { key } = this.keyFor(provider);
    const base = provider.type === 'anthropic' ? (provider.baseURL || 'https://api.anthropic.com') + '/v1' : provider.type === 'openai' ? (provider.baseURL || 'https://api.openai.com/v1') : provider.baseURL;
    const headers = provider.type === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { ...(key ? { authorization: 'Bearer ' + key } : {}), ...(provider.headers || {}) };
    const res = await this.fetch(base + '/models', { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) fail(`${provider.label} returned ${res.status} when listing models.`, 502);
    const body = await res.json();
    const list = (body.data || []).map(m => ({ id: m.id, label: m.display_name || m.name || m.id })).slice(0, 500);
    this.modelCache.set(id, { at: Date.now(), list }); return list;
  }
}
