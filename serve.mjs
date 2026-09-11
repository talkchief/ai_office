// Cloud AI Office — the server. The office runs on any chat model you configure in Settings → Models & keys:
// the Program Manager delegates to department leads, leads delegate to specialists, and anything that
// would leave the office waits for the CEO. State lives in data/ (SQLite + JSON); the Brain is a folder of notes.
// The office itself (stores, engine, routines, chat, API) is built by office-instance.mjs; this file is the
// configuration, the access code and the HTTP pipeline around it.
//
//   npm start            → http://localhost:4520
//   PORT=4600 npm start  → another port
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT } from './config.mjs';
import { createOfficeAccess, sameOrigin } from './auth.mjs';
import { createOfficeInstance } from './office-instance.mjs';
import { json } from './server/routes.mjs';
import { readJsonBody as body } from './http-body.mjs';

const cfg = loadConfig();
const HTML = process.env.AO_HTML || path.join(ROOT, 'dist', 'command-centre-v2.html');
const DATA = process.env.AO_DATA || path.join(ROOT, 'data');
const BRAIN = cfg.brainPath;
const version = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } })();

const instance = await createOfficeInstance({ dataDir: DATA, brainDir: BRAIN, cfg, version });
const { office, settings, models, engine, toolStore, audit, router } = instance;
const officeAccess = createOfficeAccess(process.env.AO_ACCESS_KEY);
const unlockAttempts = new Map();
const oauthPage = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px system-ui;padding:40px;max-width:520px"><h1 style="font-size:20px">${title}</h1><p>${text}</p><p><a href="/">Back to the office</a></p><script>setTimeout(()=>{if(window.opener){window.opener.postMessage('connector-signed-in','*');window.close();}},1200)</script>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const secure = !!req.socket.encrypted || (loopback && req.headers['x-forwarded-proto'] === 'https');
    const local = loopback && !req.headers['x-forwarded-for'] && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '');
    const origin = settings.get().publicOrigin || `${secure ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const api = url.pathname.startsWith('/api/');
    if (api) res.setHeader('Cache-Control', 'no-store');
    if (api && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOrigin(req)) return json(res, 403, { error: 'Requests must come from this office.' });
    // Liveness for containers and monitors, before the access code: says the office is up and whether a model is ready, nothing more.
    if (url.pathname === '/api/health' && req.method === 'GET' && !officeAccess.allowed(req)) return json(res, 200, { ok: true, version, ready: models.ready() });
    if (url.pathname === '/api/auth/status' && req.method === 'GET') return json(res, 200, { locked: !officeAccess.allowed(req), secure: secure || local, accessRequired: officeAccess.required, providersReady: models.ready() });
    if (url.pathname === '/api/auth/unlock' && req.method === 'POST') {
      if (!secure && !local) return json(res, 403, { error: 'Open this office over HTTPS before signing in.' });
      const peer = (loopback && req.headers['x-real-ip']) || req.socket.remoteAddress, now = Date.now();
      for (const [ip, attempt] of unlockAttempts) if (attempt.until < now) unlockAttempts.delete(ip);
      if (unlockAttempts.size > 2000 || unlockAttempts.get(peer)?.count >= 10) return json(res, 429, { error: 'Too many attempts. Try again in ten minutes.' });
      const input = await body(req);
      if (!officeAccess.matches(input.key)) { const attempt = unlockAttempts.get(peer) || { count: 0, until: now + 600000 }; attempt.count++; unlockAttempts.set(peer, attempt); return json(res, 401, { error: 'That office access code is not correct.' }); }
      unlockAttempts.delete(peer); res.setHeader('Set-Cookie', officeAccess.cookie(secure)); return json(res, 200, { ok: true });
    }
    // The connector's sign-in page redirects here without the office cookie (SameSite=Strict); the single-use state proves it.
    const callback = url.pathname.match(/^\/api\/tools\/([A-Za-z0-9_-]+)\/oauth\/callback$/);
    if (callback && req.method === 'GET') {
      try { const result = await toolStore.oauthCallback(callback[1], { code: url.searchParams.get('code'), state: url.searchParams.get('state') }); if (result.state === 'signed-in') audit.record({ area: 'tools', summary: `Signed in to connector ${callback[1]}` }); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(oauthPage(result.state === 'signed-in' ? 'Connector signed in' : 'Sign-in did not finish', result.state === 'signed-in' ? 'The office can now use this connector. You can close this tab.' : 'Start the sign-in again from Manage → Tools.')); }
      catch (error) { res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }); return res.end(oauthPage('Sign-in failed', String(error.message).replace(/[<>&]/g, ''))); }
    }
    if (api && !officeAccess.allowed(req)) return json(res, 401, { error: 'Unlock the office to continue.' });
    if (req.method === 'GET' && ['/', '/command-centre-v2.html', '/dark'].includes(url.pathname)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      let page = fs.readFileSync(HTML, 'utf8');
      if (officeAccess.allowed(req)) page = page.replace('<head>', '<head><script>window.__OFFICE_BOOT__=' + JSON.stringify(office.bootstrap()).replace(/</g, '\\u003c') + ';</script>');
      return res.end(url.pathname === '/dark' ? page.replace('<body>', '<body class="dark">') : page);
    }
    const match = api && router.match(req.method, url.pathname);
    if (match?.notAllowed) return json(res, 405, { error: 'Method not allowed.' });
    if (match) {
      const session = String(req.headers.cookie || '').match(/ao_session=([^;]+)/)?.[1]?.slice(-16) || req.socket.remoteAddress;
      const out = await match.handler({ req, res, url, params: match.params, secure, local, origin, session });
      if (out?.$handled) return;
      return out && out.$status ? json(res, out.$status, out.body) : json(res, 200, out ?? { ok: true });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    if (res.headersSent) return;
    const status = e.status || 500; if (status >= 500) console.error(e);
    // A failure the code named on purpose (an upstream provider that would not answer, 502) keeps its message; an unexpected one stays generic.
    json(res, status, { error: status >= 500 && !e.status ? 'Something went wrong on the server. Try again; if it repeats, check the service log.' : e.message });
  }
});

await instance.boot();
server.listen(cfg.port, process.env.HOST || undefined, () => {
  console.log(`Cloud AI Office ${version} → http://localhost:${cfg.port}`);
  console.log(`  business: ${cfg.name}   brain: ${BRAIN} (${instance.graph().notes} notes)   models: ${models.ready() ? 'ready' : 'no provider key yet — add one in Settings → Models & keys'}`);
  console.log(`  tasks: ${path.join(DATA, 'workflows.sqlite')}   routines: ${instance.loadRoutines().length} loaded`);
  instance.start();
});
process.on('unhandledRejection', reason => engine.fault('unhandled rejection', reason));
process.on('uncaughtException', error => engine.fault('uncaught exception', error));
process.on('SIGTERM', async () => { await instance.close(); server.close(() => process.exit(0)); });
