import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createClaudeAuth } from './auth.mjs';
import * as mcp from './mcp.mjs';

const exec = promisify(execFile);
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
export class ToolStore {
  constructor({ dataDir, cwd, office, execCommand = exec, discover = mcp.discover }) {
    this.file = path.join(dataDir, 'tools.json'); this.cwd = cwd; this.office = office; this.exec = execCommand; this.discover = discover; this.auth = new Map();
    this.items = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
  }
  persist() { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.items, null, 2), { mode: 0o600 }); fs.renameSync(this.file + '.tmp', this.file); }
  list() {
    const discovered = mcp.summary().servers;
    const local = this.items.map(item => {
      const server = discovered.find(s => s.id === mcp.toolId(item.name));
      return { id: mcp.toolId(item.name), name: item.name, type: item.config.type || 'stdio', url: item.config.url || '', command: item.config.command || '',
        args: item.config.args || [], hasToken: !!item.config.headers?.Authorization, envKeys: Object.keys(item.config.env || {}), status: server?.status || 'unchecked', managed: true };
    });
    return [{ id: 'web', name: 'Web search & fetch', type: 'builtin', status: 'available', managed: false }, ...local,
      ...discovered.filter(s => !local.some(l => l.id === s.id)).map(s => ({ id: s.id, name: s.name, type: s.source, status: s.status, managed: false }))].map(tool => ({ ...tool,
        origin: tool.type === 'builtin' ? 'Built into Claude' : tool.managed ? 'Added in this office' : tool.type === 'claude.ai' ? 'From your Claude account' : 'From the Claude environment',
        assignedTeams: this.office.get().teams.filter(team => team.tools.includes(tool.id)).map(team => ({id:team.id,name:team.name})),
      }));
  }
  async command(args) {
    try { return await this.exec('claude', args, { cwd: this.cwd, env: process.env, timeout: 20000, maxBuffer: 65536 }); }
    catch { throw new Error('Claude could not save this MCP configuration. Check the name and connection settings.'); }
  }
  async save(input) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(input.name || '')) invalid('Use a name beginning with a letter, followed by letters, numbers, dashes or underscores.');
    const previous = this.items.find(item => item.name === input.name);
    if (!previous && this.list().some(item => item.id === mcp.toolId(input.name))) invalid('That name already belongs to an existing connector.');
    let config;
    if (['http', 'sse'].includes(input.type)) {
      let url; try { url = new URL(input.url); } catch { invalid('Enter a valid MCP endpoint URL.'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) invalid('Use an HTTP(S) endpoint and put credentials in the token field.');
      config = { type: input.type, url: url.href };
      const token = input.clearToken ? '' : input.token || previous?.config.headers?.Authorization?.replace(/^Bearer /, '') || '';
      if (token) { if (typeof token !== 'string' || /[\r\n]/.test(token) || token.length > 8192) invalid('Invalid bearer token.'); config.headers = { Authorization: 'Bearer ' + token }; }
    } else if (input.type === 'stdio') {
      if (!input.command || typeof input.command !== 'string' || input.command.length > 1000 || /[\r\n]/.test(input.command)) invalid('Enter the executable for this MCP server.');
      if (!Array.isArray(input.args) || input.args.length > 50 || input.args.some(a => typeof a !== 'string' || a.length > 2000)) invalid('Arguments must be a JSON array of strings.');
      const env = { ...(previous?.config.env || {}), ...(input.env || {}) };
      if (Object.keys(env).length > 30 || Object.entries(env).some(([k, v]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== 'string' || v.length > 8192)) invalid('Environment values must be strings with valid variable names.');
      config = { type: 'stdio', command: input.command, args: input.args, env };
    } else invalid('Choose HTTP, SSE or a local command.');
    if (previous) await this.command(['mcp', 'remove', '--scope', 'user', input.name]);
    try { await this.command(['mcp', 'add-json', '--scope', 'user', input.name, JSON.stringify(config)]); }
    catch (error) { if (previous) await this.command(['mcp', 'add-json', '--scope', 'user', previous.name, JSON.stringify(previous.config)]); throw error; }
    if (previous) previous.config = config; else this.items.push({ name: input.name, config });
    this.persist(); await this.discover({ timeout: 15000 });
    return this.list();
  }
  async remove(id) {
    const item = this.items.find(item => mcp.toolId(item.name) === id);
    if (!item) invalid('This connector is managed by Claude. Unassign it here, or remove it from your Claude account.');
    this.auth.get(id)?.stop(); this.auth.delete(id);
    await this.command(['mcp', 'remove', '--scope', 'user', item.name]);
    this.items = this.items.filter(i => i !== item); this.persist();
    const config = this.office.get();
    for (const team of config.teams) team.tools = team.tools.filter(t => t !== id);
    for (const agent of config.agents) agent.tools = agent.tools.filter(t => t !== id);
    this.office.update(config);
    await this.discover({ timeout: 15000 }); return this.list();
  }
  login(id) {
    const tool = this.list().find(t => t.id === id && t.type !== 'builtin');
    if (!tool) invalid('Choose an MCP server.');
    if (!this.auth.has(id)) {
      const local = this.items.find(t => mcp.toolId(t.name) === id);
      const server = mcp.summary().servers.find(s => s.id === id);
      const name = local?.name || (server?.source === 'claude.ai' ? 'claude.ai ' + server.name : tool.name);
      this.auth.set(id, createClaudeAuth({ cwd: this.cwd, loginArgs: ['mcp', 'login', '--no-browser', name], logoutArgs: ['mcp', 'logout', name],
        authorizeURL: url => url.protocol === 'https:' && (url.searchParams.has('state') || url.pathname.includes('oauth') || url.pathname.includes('authorize')),
        statusReader: async force => { if (force) await this.discover({ timeout: 15000 }); return { authenticated: mcp.summary().servers.find(s => s.id === id)?.status === 'connected', cliInstalled: true }; },
        onChange: async () => { await this.discover({ timeout: 15000 }); },
      }));
    }
    return this.auth.get(id);
  }
  close() { for (const auth of this.auth.values()) auth.stop(); }
}
