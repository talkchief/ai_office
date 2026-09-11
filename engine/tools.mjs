// Tools for agents: MCP connectors from the office's own store, web access, and outbound classification.
import dns from 'node:dns/promises';
import net from 'node:net';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const OUTBOUND = /(^|_)(send|create|update|delete|remove|post|publish|pay|charge|refund|write|move|archive|reply|forward|invite|cancel|trash|label|modify|edit|upload|share|schedule|book|transfer|submit|approve|reject|merge|close|resolve|assign)(_|$)/i;
// Same ids as mcp.mjs (case kept): teams already reference connectors as e.g. claude_ai_Gmail.
export const toolId = name => String(name).replace(/[^A-Za-z0-9_]+/g, '_');
// What one person may call: the team's tools (or the subset they list when not inheriting) plus their own grants.
// `known` limits personal grants to tools that exist (the connector ids plus 'web'); without it every listed id counts.
export const agentToolIds = (team, agent, known = null) => { const own = (agent?.tools || []).filter(id => !known || known.has(id)); return [...new Set([...(team?.tools || []).filter(id => agent?.inheritTools !== false || own.includes(id)), ...own])]; };
// A person's grants beyond the team's: what the lead needs to know to delegate well.
export const extraToolIds = (team, agent, known = null) => (agent?.tools || []).filter(id => !(team?.tools || []).includes(id) && (!known || known.has(id)));

// A tool is outbound unless the server marks it read-only and the CEO has not listed it as outbound.
export function isOutbound(t, { outboundTools = [], readOnlyTools = [] } = {}) {
  if (outboundTools.includes(t.name)) return true;
  if (readOnlyTools.includes(t.name)) return false;
  const hints = t.metadata?.annotations || {};
  if (hints.destructiveHint === true) return true;
  if (hints.readOnlyHint === true) return false;
  const bare = t.name.includes('__') ? t.name.split('__').at(-1) : t.name;
  return OUTBOUND.test(bare) || hints.readOnlyHint !== true && /^(set|put|add|mark|change)(_|$)/i.test(bare);
}

// MCP server config for the adapter, keyed by the connector id teams already reference.
export function mcpServers(items, { authProviderFor = () => undefined } = {}) {
  const servers = {};
  for (const item of items) {
    const id = toolId(item.name), c = item.config || {};
    if (c.type === 'stdio') servers[id] = { transport: 'stdio', command: c.command, args: c.args || [], env: { ...process.env, ...(c.env || {}) }, restart: { enabled: true, maxAttempts: 2, delayMs: 1000 } };
    else if (c.url) servers[id] = { transport: c.type === 'sse' ? 'sse' : 'http', url: c.url, ...(c.headers ? { headers: c.headers } : {}), ...(authProviderFor(item) ? { authProvider: authProviderFor(item) } : {}), reconnect: { enabled: true, maxAttempts: 3, delayMs: 1000 } };
  }
  return servers;
}

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(127|10|192\.168)\./i];
export async function assertPublicUrl(raw, lookup = dns.lookup) {
  let url; try { url = new URL(raw); } catch { throw new Error('That is not a valid URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only public http(s) URLs without credentials can be fetched.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(a => PRIVATE.some(p => p.test(a.address)) || a.address === 'localhost')) throw new Error('Private and local network addresses cannot be fetched.');
  return url;
}
export const toText = html => String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|h\d|li|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

// A page that cannot be fetched is a result the agent reads and works around, never an error that ends the run.
const fetchReason = error => error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'no reply within 20 seconds' : error?.cause?.code || error?.cause?.message || error?.message || 'network error';
// A page comes back trimmed: what an agent keeps in its context is re-sent on every later call, so a long page costs many times
// its own size. The default is enough for an article; a longer read is asked for explicitly.
export const FETCH_DEFAULT_CHARS = 12000, FETCH_MAX_CHARS = 40000;
export function webFetchTool({ fetchImpl = globalThis.fetch, lookup } = {}) {
  return tool(async ({ url, maxChars }) => {
    const limit = Math.min(FETCH_MAX_CHARS, Math.max(2000, Number(maxChars) || FETCH_DEFAULT_CHARS));
    let target; try { target = await assertPublicUrl(url, lookup); } catch (error) { return `Could not fetch ${url}: ${error.message}`; }
    let res; try { res = await fetchImpl(target, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'TalkchiefAISpace/1.0 (+research)' } }); }
    catch (error) { return `Could not fetch ${target.href}: ${fetchReason(error)}. Try another address or another source.`; }
    if (res.status >= 300 && res.status < 400) { const to = res.headers.get('location') || ''; let next = to; try { next = new URL(to, target).href; } catch {} return `Redirected to ${next}. Fetch that URL if it is relevant.`; }
    if (!res.ok) return `The page returned HTTP ${res.status}.`;
    const type = res.headers.get('content-type') || '';
    if (!/text|json|xml|html/.test(type)) return `The page is ${type || 'binary'} and cannot be read as text.`;
    let body; try { body = (await res.text()).slice(0, 400000); } catch (error) { return `Could not read ${target.href}: ${fetchReason(error)}.`; }
    const textOut = (/html/.test(type) ? toText(body) : body); const cut = textOut.slice(0, limit);
    return (cut || 'The page had no readable text.') + (textOut.length > limit ? `

[${textOut.length - limit} more characters not shown; write down what you need from this page, or call again with maxChars up to ${FETCH_MAX_CHARS} only if the rest matters.]` : '');
  }, { name: 'web_fetch', description: `Fetch a public web page and return its readable text (the first ${FETCH_DEFAULT_CHARS.toLocaleString('en-GB')} characters by default). Use it for the sources the task needs and cite the URL. Write down what you learned from a page before fetching the next one; fetched text is expensive to keep. A page that cannot be fetched comes back as a short explanation.`, schema: z.object({ url: z.string().describe('Public http(s) URL'), maxChars: z.number().optional().describe(`How much of the page to return, up to ${FETCH_MAX_CHARS}; leave it out unless the rest of the page matters`) }) });
}
export const anthropicWebSearch = { type: 'web_search_20260209', name: 'web_search', max_uses: 8 };

// The adapter that hands MCP tools to the model flattens each schema and keeps only unions of objects, so a server's
// "one of these strings" or "boolean or null" reaches the model with no type at all and the model guesses. Rebuild what the
// server declared: constants become an enum, "X or null" becomes X, unions of objects merge, anything else stays a union.
const typeOfValues = values => { const kinds = new Set(values.map(v => v === null ? 'null' : typeof v)); if (kinds.size !== 1) return undefined; const k = [...kinds][0]; return ['string', 'number', 'boolean'].includes(k) ? k : undefined; };
export function restoreSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(restoreSchema);
  const { _meta, $schema, anyOf, oneOf, ...rest } = schema;
  const out = { ...rest };
  const union = anyOf || oneOf;
  if (Array.isArray(union)) {
    const members = union.filter(m => m && typeof m === 'object' && m.type !== 'null' && !(Array.isArray(m.type) && m.type.every(t => t === 'null'))).map(restoreSchema);
    if (members.length && members.every(m => m.enum || m.const !== undefined)) { const values = [...new Set(members.flatMap(m => m.enum || [m.const]))]; out.enum = values; out.type = out.type || typeOfValues(values); }
    else if (members.length === 1) Object.assign(out, members[0], rest);
    else if (members.length && members.every(m => m.type === 'object' || m.properties)) {
      out.type = 'object'; out.properties = Object.assign({}, ...members.map(m => m.properties || {}));
      const sets = members.map(m => new Set(m.required || [])), common = [...sets[0]].filter(k => sets.every(set => set.has(k)));
      if (common.length) out.required = common;
    } else if (members.length) out.anyOf = members;
  }
  if (out.const !== undefined) { out.enum = out.enum || [out.const]; delete out.const; }
  if (out.enum && !out.type) out.type = typeOfValues(out.enum);
  if (out.properties && typeof out.properties === 'object') out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, restoreSchema(v)]));
  if (out.items) out.items = Array.isArray(out.items) ? out.items.map(restoreSchema) : restoreSchema(out.items);
  if (out.additionalProperties && typeof out.additionalProperties === 'object') out.additionalProperties = restoreSchema(out.additionalProperties);
  return out;
}

// Connects to every configured MCP server once and hands out tools per agent.
export class ToolHub {
  constructor({ items = () => [], settings = () => ({}), clientFactory, authProviderFor, busy = () => false } = {}) {
    this.items = items; this.settings = settings; this.clientFactory = clientFactory; this.authProviderFor = authProviderFor; this.busy = busy;
    this.client = null; this.tools = []; this.status = {}; this.loading = null; this.retired = [];
  }
  // A reload never closes the session that running tasks still hold: the old client retires and is closed once no run can outlive it.
  async load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const servers = mcpServers(this.items(), { authProviderFor: this.authProviderFor });
      const previous = this.client;
      this.status = Object.fromEntries(Object.keys(servers).map(id => [id, 'connecting']));
      if (!Object.keys(servers).length) { this.client = null; this.tools = []; }
      else {
        const make = this.clientFactory || (async config => { const { MultiServerMCPClient } = await import('@langchain/mcp-adapters'); return new MultiServerMCPClient(config); });
        const client = await make({ mcpServers: servers, prefixToolNameWithServerName: true, additionalToolNamePrefix: 'mcp', onConnectionError: 'ignore', useStandardContentBlocks: false, defaultToolTimeout: 120000 });
        const tools = await client.getTools().catch(() => []);
        await this.restoreSchemas(client, tools, Object.keys(servers));
        this.client = client; this.tools = tools;
        for (const id of Object.keys(servers)) this.status[id] = tools.some(t => t.name.startsWith(`mcp__${id}__`)) ? 'connected' : 'unavailable';
      }
      if (previous) this.retired.push({ client: previous, at: Date.now() });
      this.sweep();
      return this.tools;
    })().finally(() => { this.loading = null; });
    return this.loading;
  }
  async restoreSchemas(client, tools, ids) {
    if (typeof client?.getClient !== 'function') return;
    for (const id of ids) {
      let listed; try { listed = (await (await client.getClient(id))?.listTools())?.tools || []; } catch { continue; }
      for (const raw of listed) { const t = tools.find(t => t.name === `mcp__${id}__${raw.name}`); if (t && raw.inputSchema) t.schema = restoreSchema(raw.inputSchema); }
    }
  }
  // A retired session is closed once the no-progress limit has passed and no task is running, so a long task never loses a connector mid-run.
  graceMs() { return Math.max(1, Number(this.settings()?.runTimeoutMinutes) || 20) * 60000; }
  sweep(now = Date.now()) {
    if (this.busy()) return;
    const keep = [];
    for (const r of this.retired) { if (now - r.at >= this.graceMs()) Promise.resolve(r.client?.close?.()).catch(() => {}); else keep.push(r); }
    this.retired = keep;
  }
  async ensure() { if (!this.client && !this.tools.length) await this.load(); return this.tools; }
  // The tools one agent may call: the team's tools (all of them, or only the ones the person lists when they opt out of inheriting)
  // plus any tool granted to that person alone. Evaluations never get outbound tools.
  toolsFor({ agent, team, provider, evaluation = false, readOnly = false }) {
    this.sweep();
    const assigned = agentToolIds(team, agent, new Set(['web', ...this.tools.map(t => t.name.split('__')[1]).filter(Boolean)]));
    const settings = this.settings();
    const out = [], interruptOn = {};
    for (const t of this.tools) {
      const server = assigned.find(id => t.name.startsWith(`mcp__${id}__`)); if (!server) continue;
      const outbound = isOutbound(t, settings);
      if (outbound && (evaluation || readOnly)) continue;
      out.push(t); if (outbound) interruptOn[t.name] = { allowedDecisions: ['approve', 'edit', 'reject'] };
    }
    if (assigned.includes('web')) { out.push(webFetchTool()); if (provider === 'anthropic') out.push(anthropicWebSearch); }
    return { tools: out, interruptOn };
  }
  catalog() { return this.tools.map(t => ({ name: t.name, description: String(t.description || '').slice(0, 300), outbound: isOutbound(t, this.settings()) })); }
  async close() {
    for (const r of this.retired) await Promise.resolve(r.client?.close?.()).catch(() => {});
    this.retired = []; await this.client?.close?.().catch(() => {});
  }
}
