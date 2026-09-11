// Cloud AI Office — the server. The office runs on any chat model you configure in Settings → Models & keys:
// the Program Manager delegates to department leads, leads delegate to specialists, and anything that
// would leave the office waits for the CEO. State lives in data/ (SQLite + JSON); the Brain is a folder of notes.
// The office itself (stores, engine, routines, chat, API) is built by office-instance.mjs; this file is the
// configuration, the sign-in and the HTTP pipeline around it.
//
//   npm start            → http://localhost:4520, one office (AO_MODE=single, the default)
//   AO_MODE=hosted       → many companies: accounts, one office per tenant under AO_TENANTS_DIR, platform-owned models
//   PORT=4600 npm start  → another port
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT } from './config.mjs';
import { createOfficeAccess, sameOrigin, cookieValue } from './auth.mjs';
import { createOfficeInstance } from './office-instance.mjs';
import { Router, json } from './server/routes.mjs';
import { readJsonBody as body, readRawBody } from './http-body.mjs';
import { RateLimiter } from './server/ratelimit.mjs';
import * as context from './server/request-context.mjs';

const cfg = loadConfig();
const HTML = process.env.AO_HTML || path.join(ROOT, 'dist', 'command-centre-v2.html');
const DATA = process.env.AO_DATA || path.join(ROOT, 'data');
const BRAIN = cfg.brainPath;
const HOSTED = process.env.AO_MODE === 'hosted';
const version = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } })();
const oauthPage = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px system-ui;padding:40px;max-width:520px"><h1 style="font-size:20px">${title}</h1><p>${text}</p><p><a href="/">Back to the office</a></p><script>setTimeout(()=>{if(window.opener){window.opener.postMessage('connector-signed-in','*');window.close();}},1200)</script>`;
const peerOf = (req, loopback) => (loopback && req.headers['x-real-ip']) || req.socket.remoteAddress;

/* ---------- single office: the access code and one instance ---------- */
const single = HOSTED ? null : await createOfficeInstance({ dataDir: DATA, brainDir: BRAIN, cfg, version });
const officeAccess = createOfficeAccess(process.env.AO_ACCESS_KEY);
const unlockLimiter = new RateLimiter({ max: 10, windowMs: 600000, maxKeys: 2000 });

/* ---------- hosted: accounts, the platform, one office per tenant ---------- */
let platform = null, accounts = null, registry = null, authRouter = null, controlRouter = null, adminRouter = null, mailer = null, intake = null, inboundFromRequest = null;
const publicOrigin = () => process.env.AO_PUBLIC_ORIGIN || `http://localhost:${cfg.port}`;
if (HOSTED) {
  const { PlatformStore } = await import('./platform.mjs');
  const { Accounts } = await import('./accounts.mjs');
  const { TenantRegistry } = await import('./tenant-registry.mjs');
  const { registerAuthRoutes, registerAccountsApi } = await import('./server/accounts-api.mjs');
  const { registerAdminApi } = await import('./server/admin-api.mjs');
  platform = new PlatformStore({ dir: process.env.AO_PLATFORM_DIR || path.join(DATA, 'platform'), env: process.env, adminEmails: String(process.env.AO_PLATFORM_ADMINS || '').split(',').map(s => s.trim()).filter(Boolean), registration: process.env.AO_REGISTRATION || null });
  accounts = new Accounts({ file: process.env.AO_ACCOUNTS || path.join(DATA, 'accounts.sqlite') });
  registry = new TenantRegistry({ accounts, platform, dir: process.env.AO_TENANTS_DIR || path.join(ROOT, 'tenants'), version, cfg, idleMs: (Number(process.env.AO_TENANT_IDLE_MINUTES) || 30) * 60000, maxLoaded: Number(process.env.AO_TENANTS_MAX_LOADED) || 50, brainTemplate: process.env.AO_BRAIN_TEMPLATE || null });
  authRouter = new Router(); controlRouter = new Router(); adminRouter = new Router();
  // Mail intake: a transactional provider's inbound webhook becomes tasks; the office writes receipts, results and questions back.
  const { mailerFromEnv } = await import('./mail/outbound.mjs'); const { createIntake } = await import('./mail/intake.mjs'); ({ inboundFromRequest } = await import('./mail/inbound.mjs'));
  mailer = mailerFromEnv(process.env, { outbox: process.env.AO_MAIL_OUTBOX || path.join(platform.dir, 'mail-outbox.json') });
  intake = mailer ? createIntake({ accounts, registry, mailer, domain: process.env.AO_MAIL_DOMAIN || '', publicOrigin, log: console.log }) : null;
  registry.onLoad = instance => intake?.watch(instance);
  registerAuthRoutes(authRouter, { accounts, platform, registry, log: console.log });
  registerAccountsApi(controlRouter, { accounts, platform, publicOrigin, mailDomain: process.env.AO_MAIL_DOMAIN || '', mailer, intake });
  registerAdminApi(adminRouter, { accounts, platform, registry });
}
const authLimiter = new RateLimiter({ max: 20, windowMs: 600000, maxKeys: 5000 });
const publicUser = u => u && { id: u.id, email: u.email, name: u.name, role: u.role, platformAdmin: platform.isAdmin(u), tenantId: u.tenantId };
const modelsReady = () => (HOSTED ? platform.models : single.models).ready();

// Runs a matched route: the handler sees the request, the viewer and the office; its return value becomes the response.
async function respond(match, args, res) {
  const out = await context.run({ user: args.user || null, tenantId: args.user?.tenantId || null, instance: args.instance || null }, () => match.handler(args));
  if (out?.$handled) return;
  return out && out.$status ? json(res, out.$status, out.body) : json(res, 200, out ?? { ok: true });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const secure = !!req.socket.encrypted || (loopback && req.headers['x-forwarded-proto'] === 'https');
    const local = loopback && !req.headers['x-forwarded-for'] && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '');
    const api = url.pathname.startsWith('/api/');
    if (api) res.setHeader('Cache-Control', 'no-store');
    // The mail provider's webhook: no cookie, no same-origin check; the shared secret (or the provider's signature over the raw body) is the proof.
    // It records the message id, answers at once and hands the message to the intake; a repeated delivery is acknowledged and ignored.
    const hook = HOSTED && req.method === 'POST' && /^\/api\/mail\/inbound\/([a-z]+)$/.exec(url.pathname);
    if (hook) {
      if (!mailer || !intake) return json(res, 503, { error: 'Mail intake is not configured on this platform.' });
      let message;
      try { message = await inboundFromRequest({ provider: hook[1], req, rawBody: await readRawBody(req, 40 * 1024 * 1024), secret: process.env.AO_MAIL_WEBHOOK_SECRET || '' }); }
      catch (error) { return json(res, error.status || 400, { error: error.message }); }
      if (!accounts.recordInbound({ provider: hook[1], providerMessageId: message.providerMessageId })) return json(res, 200, { duplicate: true });
      json(res, 202, { ok: true });
      setImmediate(() => intake.handle(message).then(r => accounts.updateInbound(hook[1], message.providerMessageId, { jobId: r.jobId || null, outcome: r.outcome }))
        .catch(error => { console.warn('mail intake:', error.message); accounts.updateInbound(hook[1], message.providerMessageId, { outcome: 'error: ' + String(error.message).slice(0, 200) }); }));
      return;
    }
    if (api && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOrigin(req)) return json(res, 403, { error: 'Requests must come from this office.' });
    const cookie = cookieValue(req);
    // Hosted: the viewer, from the session cookie. Single: the access code decides.
    const user = HOSTED ? accounts.sessionUser(cookie) : null;
    const allowed = HOSTED ? !!user : officeAccess.allowed(req);
    // Liveness for containers and monitors, before any sign-in: says the office is up and whether a model is ready, nothing more.
    if (url.pathname === '/api/health' && req.method === 'GET' && !allowed) return json(res, 200, { ok: true, version, mode: HOSTED ? 'hosted' : 'single', ready: modelsReady() });
    if (url.pathname === '/api/auth/status' && req.method === 'GET') {
      return json(res, 200, HOSTED ? { mode: 'hosted', locked: !user, user: publicUser(user), secure: secure || local, registrationOpen: platform.registrationOpen(), providersReady: modelsReady() }
        : { mode: 'single', locked: !allowed, secure: secure || local, accessRequired: officeAccess.required, providersReady: modelsReady() });
    }
    if (!HOSTED && url.pathname === '/api/auth/unlock' && req.method === 'POST') {
      if (!secure && !local) return json(res, 403, { error: 'Open this office over HTTPS before signing in.' });
      const peer = peerOf(req, loopback);
      if (!unlockLimiter.hit(peer)) return json(res, 429, { error: 'Too many attempts. Try again in ten minutes.' });
      const input = await body(req);
      if (!officeAccess.matches(input.key)) return json(res, 401, { error: 'That office access code is not correct.' });
      unlockLimiter.reset(peer); res.setHeader('Set-Cookie', officeAccess.cookie(secure)); return json(res, 200, { ok: true });
    }
    // Hosted: register, sign in, accept an invitation, sign out — over HTTPS (or locally), a few attempts per address.
    const auth = HOSTED && url.pathname.startsWith('/api/auth/') && authRouter.match(req.method, url.pathname);
    if (auth && !auth.notAllowed) {
      if (req.method === 'POST') { if (!secure && !local) return json(res, 403, { error: 'Open this office over HTTPS before signing in.' }); if (!authLimiter.hit(peerOf(req, loopback))) return json(res, 429, { error: 'Too many attempts. Try again in ten minutes.' }); }
      return await respond(auth, { req, res, url, params: auth.params, secure, local, cookie, ua: req.headers['user-agent'] || '', user }, res);
    }
    // The office of this request: the one office, or the signed-in person's tenant (built on first use).
    let instance = single;
    if (HOSTED && user) {
      const tenant = accounts.tenant(user.tenantId);
      if (!tenant || tenant.suspendedAt) { if (api) return json(res, 403, { error: 'This office is suspended. Contact the platform administrator.' }); }
      else instance = await registry.get(tenant.id);
    }
    // The connector's sign-in page redirects here; in a single office without the (Strict) cookie the single-use state is the proof, in a hosted one the Lax cookie names the office.
    const callback = url.pathname.match(/^\/api\/tools\/([A-Za-z0-9_-]+)\/oauth\/callback$/);
    if (callback && req.method === 'GET') {
      if (!instance) { res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }); return res.end(oauthPage('Sign in first', 'Open the office, sign in, then start the connector sign-in again from Manage → Tools.')); }
      try { const result = await instance.toolStore.oauthCallback(callback[1], { code: url.searchParams.get('code'), state: url.searchParams.get('state') }); if (result.state === 'signed-in') context.run({ user }, () => instance.audit.record({ area: 'tools', summary: `Signed in to connector ${callback[1]}` })); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(oauthPage(result.state === 'signed-in' ? 'Connector signed in' : 'Sign-in did not finish', result.state === 'signed-in' ? 'The office can now use this connector. You can close this tab.' : 'Start the sign-in again from Manage → Tools.')); }
      catch (error) { res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }); return res.end(oauthPage('Sign-in failed', String(error.message).replace(/[<>&]/g, ''))); }
    }
    if (api && !allowed) return json(res, 401, { error: HOSTED ? 'Sign in to continue.' : 'Unlock the office to continue.' });
    if (req.method === 'GET' && ['/', '/command-centre-v2.html', '/dark'].includes(url.pathname)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      let page = fs.readFileSync(HTML, 'utf8');
      // What the page knows before its first request: the roster for the scene, the mode, and (hosted) who is signed in.
      const boot = { ...(allowed && instance ? instance.office.bootstrap() : {}), mode: HOSTED ? 'hosted' : 'single', user: HOSTED ? publicUser(user) : null, limits: instance ? instance.office.limits : null, registrationOpen: HOSTED ? platform.registrationOpen() : null, managedModels: HOSTED, mailDomain: HOSTED ? process.env.AO_MAIL_DOMAIN || '' : '' };
      page = page.replace('<head>', '<head><script>window.__OFFICE_BOOT__=' + JSON.stringify(boot).replace(/</g, '\\u003c') + ';</script>');
      return res.end(url.pathname === '/dark' ? page.replace('<body>', '<body class="dark">') : page);
    }
    if (!api) return json(res, 404, { error: 'not found' });
    const session = cookie.slice(-16) || req.socket.remoteAddress;
    const args = { req, res, url, secure, local, origin: instance?.settings.get().publicOrigin || `${secure ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`, session, cookie, ua: req.headers['user-agent'] || '', user, instance };
    // Hosted: the platform admin panel, then the routes about people; both live outside any one office.
    if (HOSTED) {
      const adminMatch = url.pathname.startsWith('/api/admin/') && adminRouter.match(req.method, url.pathname);
      if (adminMatch?.notAllowed) return json(res, 405, { error: 'Method not allowed.' });
      if (adminMatch) { if (!platform.isAdmin(user)) return json(res, 403, { error: 'Platform administrators only.' }); return await respond(adminMatch, { ...args, params: adminMatch.params }, res); }
      const control = controlRouter.match(req.method, url.pathname);
      if (control?.notAllowed) return json(res, 405, { error: 'Method not allowed.' });
      if (control) return await respond(control, { ...args, params: control.params }, res);
      if (!instance) return json(res, 403, { error: 'This office is suspended. Contact the platform administrator.' });
    }
    const match = instance.router.match(req.method, url.pathname);
    if (match?.notAllowed) return json(res, 405, { error: 'Method not allowed.' });
    if (match) return await respond(match, { ...args, params: match.params }, res);
    json(res, 404, { error: 'not found' });
  } catch (e) {
    if (res.headersSent) return;
    const status = e.status || 500; if (status >= 500) console.error(e);
    // A failure the code named on purpose (an upstream provider that would not answer, 502) keeps its message; an unexpected one stays generic.
    json(res, status, { error: status >= 500 && !e.status ? 'Something went wrong on the server. Try again; if it repeats, check the service log.' : e.message });
  }
});

if (single) await single.boot();
server.listen(cfg.port, process.env.HOST || undefined, () => {
  console.log(`Cloud AI Office ${version} → http://localhost:${cfg.port}${HOSTED ? '  (hosted mode)' : ''}`);
  if (single) {
    console.log(`  business: ${cfg.name}   brain: ${BRAIN} (${single.graph().notes} notes)   models: ${single.models.ready() ? 'ready' : 'no provider key yet — add one in Settings → Models & keys'}`);
    console.log(`  tasks: ${path.join(DATA, 'workflows.sqlite')}   routines: ${single.loadRoutines().length} loaded`);
    single.start();
  } else {
    console.log(`  mail: ${mailer ? (mailer.dryRun ? 'dry run → ' + mailer.outbox : mailer.provider + ' · ' + (mailer.domain || 'no domain')) : 'not configured (AO_MAIL_API_KEY or AO_MAIL_DRY_RUN=1)'}`);
    console.log(`  tenants: ${registry.dir}   accounts: ${accounts.file}   platform: ${platform.dir}   models: ${platform.models.ready() ? 'ready' : 'no provider key yet — a platform admin adds one under /api/admin/providers'}   registration: ${platform.get().registration}`);
    registry.start();
  }
});
process.on('unhandledRejection', reason => (single ? single.engine.fault('unhandled rejection', reason) : console.error('unhandled rejection:', reason)));
process.on('uncaughtException', error => (single ? single.engine.fault('uncaught exception', error) : console.error('uncaught exception:', error)));
process.on('SIGTERM', async () => { if (single) await single.close(); else { await registry.closeAll(); accounts.close(); } server.close(() => process.exit(0)); });
