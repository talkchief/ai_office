// A tiny method + path router. Handlers return a value (200), or { $status, body } for another status.
export const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
export const httpError = (message, status = 400) => Object.assign(new Error(message), { status });
export class Router {
  constructor() { this.routes = []; }
  on(method, pattern, handler) {
    const keys = [], re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, key) => { keys.push(key); return '([^/]+)'; }) + '$');
    this.routes.push({ method, re, keys, handler }); return this;
  }
  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.re.exec(pathname); if (!m) continue; pathMatched = true;
      if (route.method === method) return { handler: route.handler, params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return pathMatched ? { notAllowed: true } : null;
  }
}
