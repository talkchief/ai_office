// Connectors the office owns, in data/tools.json (mode 0600). Servers found in a Claude Code install can be imported.
// Sign-in uses the MCP OAuth flow (discovery, client registration, PKCE); tokens never leave the server.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as mcp from './mcp.mjs';
import { toolId } from './engine/tools.mjs';

const invalid = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;
const sameText = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class ToolStore {
  // `allowStdio` false refuses local-command connectors (a hosted office never runs a process for a tenant).
  constructor({ dataDir, office, discover = mcp.discover, summary = () => mcp.summary(), statusFor = () => 'unchecked', authFn = null, allowStdio = true }) {
    this.file = path.join(dataDir, 'tools.json');
    Object.assign(this, { office, discover, summary, statusFor, authFn, allowStdio });
    this.items = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
    this.pendingUrls = new Map(); this.onChange = () => {};
  }
  persist() { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.items, null, 2), { mode: 0o600 }); fs.renameSync(this.file + '.tmp', this.file); }
  changed() { this.persist(); try { this.onChange(); } catch {} }
  byId(id) { return this.items.find(item => toolId(item.name) === id); }
  list() {
    const local = this.items.map(item => {
      const id = toolId(item.name), c = item.config || {};
      return { id, name: item.name, type: c.type || 'stdio', url: c.url || '', command: c.command || '', args: c.args || [], hasToken: !!c.headers?.Authorization, envKeys: Object.keys(c.env || {}),
        auth: c.type === 'stdio' ? 'none' : item.oauth?.tokens ? 'signed-in' : 'not-signed-in', status: this.statusFor(id), managed: true, origin: 'Added in this office' };
    });
    const found = (this.summary()?.servers || []).filter(s => s.target && !local.some(l => l.id === s.id || (l.url && l.url === s.target)));
    const candidates = found.map(s => ({ id: s.id, name: s.name, type: 'candidate', target: s.target, status: 'not-imported', managed: false, origin: 'Found in Claude Code · import it to use it here' }));
    const { teams, agents } = this.office.get();
    return [{ id: 'web', name: 'Web search & fetch', type: 'builtin', status: 'available', managed: false, origin: 'Built into the office' }, { id: 'sandbox', name: 'Sandbox (run code)', type: 'builtin', status: 'available', managed: false, origin: 'Built into the office: Python and Node in a throwaway container per task' }, ...local, ...candidates]
      .map(tool => ({ ...tool, assignedTeams: teams.filter(t => t.tools.includes(tool.id) || agents.some(a => a.department === t.id && (a.tools || []).includes(tool.id))).map(t => ({ id: t.id, name: t.name, whole: t.tools.includes(tool.id), people: agents.filter(a => a.department === t.id && !t.tools.includes(tool.id) && (a.tools || []).includes(tool.id)).map(a => a.name) })) }));
  }
  save(input) {
    if (!NAME.test(input.name || '')) invalid('Use a name beginning with a letter, followed by letters, numbers, dashes or underscores.');
    const previous = this.items.find(item => item.name === input.name);
    if (!previous && this.list().some(item => item.id === toolId(input.name) && item.type !== 'candidate')) invalid('That name already belongs to an existing connector.');
    let config;
    if (['http', 'sse'].includes(input.type)) {
      let url; try { url = new URL(input.url); } catch { invalid('Enter a valid MCP endpoint URL.'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) invalid('Use an HTTP(S) endpoint and put credentials in the token field.');
      config = { type: input.type, url: url.href };
      const token = input.clearToken ? '' : input.token || previous?.config.headers?.Authorization?.replace(/^Bearer /, '') || '';
      if (token) { if (typeof token !== 'string' || /[\r\n]/.test(token) || token.length > 8192) invalid('Invalid bearer token.'); config.headers = { Authorization: 'Bearer ' + token }; }
    } else if (input.type === 'stdio') {
      if (!this.allowStdio) invalid('This office only connects to MCP servers by URL; local commands are not available here.');
      if (!input.command || typeof input.command !== 'string' || input.command.length > 1000 || /[\r\n]/.test(input.command)) invalid('Enter the executable for this MCP server.');
      if (!Array.isArray(input.args) || input.args.length > 50 || input.args.some(a => typeof a !== 'string' || a.length > 2000)) invalid('Arguments must be a list of strings.');
      const env = { ...(previous?.config.env || {}), ...(input.env || {}) };
      if (Object.keys(env).length > 30 || Object.entries(env).some(([k, v]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== 'string' || v.length > 8192)) invalid('Environment values must be strings with valid variable names.');
      config = { type: 'stdio', command: input.command, args: input.args, env };
    } else invalid('Choose HTTP, SSE or a local command.');
    const moved = previous && previous.config.url !== config.url;
    if (previous) { previous.config = config; if (moved) delete previous.oauth; } else this.items.push({ name: input.name, config });
    this.changed(); return this.list();
  }
  remove(id) {
    const item = this.byId(id); if (!item) invalid('This connector is not managed by the office.', 404);
    this.items = this.items.filter(i => i !== item); this.pendingUrls.delete(id);
    const config = this.office.get();
    for (const team of config.teams) team.tools = team.tools.filter(t => t !== id);
    for (const agent of config.agents) agent.tools = agent.tools.filter(t => t !== id);
    this.office.update(config); this.changed(); return this.list();
  }
  // Keeps the id teams already use (claude_ai_Gmail stays claude_ai_Gmail).
  importCandidate(id) {
    const found = (this.summary()?.servers || []).find(s => s.id === id && s.target); if (!found) invalid('That server is not available to import.', 404);
    if (this.byId(id)) invalid('That connector is already in the office.', 409);
    const parts = found.target.trim().split(/\s+/);
    const config = /^https?:\/\//.test(found.target) ? { type: 'http', url: new URL(found.target).href } : { type: 'stdio', command: parts[0], args: parts.slice(1), env: {} };
    if (config.type === 'stdio' && !this.allowStdio) invalid('This office only connects to MCP servers by URL; local commands are not available here.');
    if (!NAME.test(id)) invalid('That server name cannot be imported; add it by hand instead.');
    this.items.push({ name: id, config }); this.changed(); return this.list();
  }
  provider(item) {
    const store = this, oauth = (item.oauth ||= {});
    return {
      get redirectUrl() { return oauth.redirectUrl; },
      get clientMetadata() { return { client_name: 'Talkchief AI Space', redirect_uris: [oauth.redirectUrl].filter(Boolean), grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }; },
      state: () => { oauth.state = crypto.randomBytes(24).toString('base64url'); oauth.stateAt = Date.now(); store.persist(); return oauth.state; },
      clientInformation: () => oauth.client,
      saveClientInformation: info => { oauth.client = info; store.persist(); },
      tokens: () => oauth.tokens,
      saveTokens: tokens => { oauth.tokens = tokens; oauth.savedAt = Date.now(); store.persist(); },
      redirectToAuthorization: url => { store.pendingUrls.set(toolId(item.name), String(url)); },
      saveCodeVerifier: verifier => { oauth.verifier = verifier; store.persist(); },
      codeVerifier: () => oauth.verifier,
    };
  }
  authProviderFor(item) { return item.config?.type !== 'stdio' && item.oauth?.tokens ? this.provider(item) : undefined; }
  async runAuth(provider, options) { const fn = this.authFn || (await import('@modelcontextprotocol/sdk/client/auth.js')).auth; return fn(provider, options); }
  async oauthStart(id, origin) {
    const item = this.byId(id); if (!item || item.config?.type === 'stdio' || !item.config?.url) invalid('Choose an HTTP or SSE connector to sign in.');
    if (!/^https:\/\//.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) invalid('Open the office over HTTPS to sign in to a connector.', 403);
    (item.oauth ||= {}).redirectUrl = `${origin}/api/tools/${encodeURIComponent(id)}/oauth/callback`; this.persist(); this.pendingUrls.delete(id);
    const result = await this.runAuth(this.provider(item), { serverUrl: item.config.url });
    if (result === 'AUTHORIZED') { this.changed(); return { state: 'signed-in' }; }
    const url = this.pendingUrls.get(id); if (!url) invalid('The server did not offer a sign-in page.', 502);
    return { state: 'redirect', url };
  }
  // The provider redirects the browser here without the office cookie; the single-use state is the proof.
  async oauthCallback(id, { code, state }) {
    const item = this.byId(id), oauth = item?.oauth;
    const fresh = oauth?.state && Date.now() - (oauth.stateAt || 0) < 15 * 60000;
    if (!fresh || !sameText(String(state || ''), oauth.state) || !code) invalid('This sign-in link is invalid or has expired. Start the sign-in again from Settings → Tools.');
    delete oauth.state; delete oauth.stateAt; this.persist();
    try { await this.runAuth(this.provider(item), { serverUrl: item.config.url, authorizationCode: String(code) }); }
    finally { delete oauth.verifier; this.persist(); }
    this.changed(); return { state: oauth.tokens ? 'signed-in' : 'failed' };
  }
  oauthLogout(id) { const item = this.byId(id); if (item) { delete item.oauth; this.changed(); } return this.list(); }
  close() {}
}
