// Tools for agents: MCP connectors from the office's own store, web access, and outbound classification.
import dns from 'node:dns/promises';
import net from 'node:net';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const OUTBOUND = /(^|_)(send|create|update|delete|remove|post|publish|pay|charge|refund|write|move|archive|reply|forward|invite|cancel|trash|label|modify|edit|upload|share|schedule|book|transfer|submit|approve|reject|merge|close|resolve|assign)(_|$)/i;
// Same ids as mcp.mjs (case kept): teams already reference connectors as e.g. claude_ai_Gmail.
export const toolId = name => String(name).replace(/[^A-Za-z0-9_]+/g, '_');

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
const toText = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|h\d|li|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

export function webFetchTool({ fetchImpl = globalThis.fetch, lookup } = {}) {
  return tool(async ({ url }) => {
    const target = await assertPublicUrl(url, lookup);
    const res = await fetchImpl(target, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'TalkchiefAISpace/1.0 (+research)' } });
    if (res.status >= 300 && res.status < 400) return `Redirected to ${res.headers.get('location')}. Fetch that URL if it is relevant.`;
    if (!res.ok) return `The page returned HTTP ${res.status}.`;
    const type = res.headers.get('content-type') || '';
    if (!/text|json|xml|html/.test(type)) return `The page is ${type || 'binary'} and cannot be read as text.`;
    const body = (await res.text()).slice(0, 400000);
    return (/html/.test(type) ? toText(body) : body).slice(0, 40000) || 'The page had no readable text.';
  }, { name: 'web_fetch', description: 'Fetch a public web page and return its readable text (first 40,000 characters). Use for sources the task needs; cite the URL.', schema: z.object({ url: z.string().describe('Public http(s) URL') }) });
}
export const anthropicWebSearch = { type: 'web_search_20260209', name: 'web_search', max_uses: 8 };

// Connects to every configured MCP server once and hands out tools per agent.
export class ToolHub {
  constructor({ items = () => [], settings = () => ({}), clientFactory, authProviderFor } = {}) {
    this.items = items; this.settings = settings; this.clientFactory = clientFactory; this.authProviderFor = authProviderFor;
    this.client = null; this.tools = []; this.status = {}; this.loading = null;
  }
  async load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const servers = mcpServers(this.items(), { authProviderFor: this.authProviderFor });
      await this.client?.close?.().catch(() => {});
      this.status = Object.fromEntries(Object.keys(servers).map(id => [id, 'connecting']));
      if (!Object.keys(servers).length) { this.client = null; this.tools = []; return this.tools; }
      const make = this.clientFactory || (async config => { const { MultiServerMCPClient } = await import('@langchain/mcp-adapters'); return new MultiServerMCPClient(config); });
      this.client = await make({ mcpServers: servers, prefixToolNameWithServerName: true, additionalToolNamePrefix: 'mcp', onConnectionError: 'ignore', useStandardContentBlocks: false, defaultToolTimeout: 120000 });
      this.tools = await this.client.getTools().catch(() => []);
      for (const id of Object.keys(servers)) this.status[id] = this.tools.some(t => t.name.startsWith(`mcp__${id}__`)) ? 'connected' : 'unavailable';
      return this.tools;
    })().finally(() => { this.loading = null; });
    return this.loading;
  }
  async ensure() { if (!this.client && !this.tools.length) await this.load(); return this.tools; }
  // The tools one agent may call: team assignment ∩ agent selection. Evaluations never get outbound tools.
  toolsFor({ agent, team, provider, evaluation = false, readOnly = false }) {
    const assigned = (team?.tools || []).filter(id => agent?.inheritTools !== false || (agent?.tools || []).includes(id));
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
  async close() { await this.client?.close?.().catch(() => {}); }
}
