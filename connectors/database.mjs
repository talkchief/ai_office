// The database connector: agents query the databases the CEO put in the Vault through the office, never with a password in hand.
// Ported from the Bayanatkom DB Intelligence module's model, not its code: a validator that lets through one read statement at a
// time (or one data change on a connection the CEO marked writable), one lazily created client pool per Vault entry, a circuit
// breaker per entry, and hard caps on what comes back. The drivers (pg, mysql2) are optional dependencies loaded on first use.
import { createHash } from 'node:crypto';

export const MAX_ROWS = 200, MAX_TEXT_BYTES = 100 * 1024, MAX_CELL_CHARS = 500, MAX_SQL_CHARS = 20000, DEFAULT_LIMIT = 200;
export const DEFAULT_QUERY_TIMEOUT_MS = 15000;

// Errors an agent may read: one sentence, no stack, no secret.
const plain = message => Object.assign(new Error(String(message?.message || message || 'Unknown error').slice(0, 400)), { plain: true });
const missingPackage = error => ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error?.code) || /cannot find (package|module)/i.test(String(error?.message || ''));
const withTimeout = (promise, ms, message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(plain(message)), ms); timer.unref?.();
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

/* ---------- the validator ---------- */
const READ_STARTS = new Set(['select', 'with', 'show', 'explain', 'describe', 'desc']);
const WRITE_STARTS = new Set(['insert', 'update', 'delete', 'merge', 'replace']);
// Never run by an agent, whatever the connection allows: schema and permission changes, bulk loads, files, sleeps, code. A column
// that happens to be called one of these words must be quoted; quoted names and text are masked before the check.
const NEVER = [
  [/\bdrop\b/, 'DROP'], [/\btruncate\b/, 'TRUNCATE'], [/\balter\b/, 'ALTER'], [/\bgrant\b/, 'GRANT'], [/\brevoke\b/, 'REVOKE'],
  [/\bcreate\b/, 'CREATE'], [/\brename\b/, 'RENAME'], [/\bcopy\b[\s\S]*\bprogram\b/, 'COPY … PROGRAM'], [/\bload\s+data\b/, 'LOAD DATA'],
  [/\binto\s+(outfile|dumpfile)\b/, 'INTO OUTFILE'],
  [/\b(pg_sleep|sleep|benchmark|waitfor|load_file|pg_read_file|pg_read_binary_file|pg_write_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|lo_unlink|dblink\w*|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|set_config|query_to_xml|database_to_xml|sys_exec|sys_eval|xp_cmdshell|sp_executesql|exec|execute)\s*\(/, 'a blocked function'],
];
// Words that turn a read statement into a write: a data change hiding in a CTE, a lock, a sequence bump, SELECT INTO. REPLACE is
// not here: as a word inside a read it is the string function; as a statement it is caught by the first keyword.
const HIDDEN_WRITE = /\b(insert|update|delete|merge|into|lock|call|exec|execute|nextval|setval|lastval)\b/;

// Text and quoted names are blanked (their length kept) so that nothing inside them counts as a statement, a comment or a keyword.
// Single quotes double to escape ('') as in Postgres; a backslash is an ordinary character, so a text cannot hide a second
// statement from the check. Returns null when a quote is never closed.
export function maskLiterals(text) {
  let out = '', i = 0; const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1; out += c;
      for (;;) {
        if (j >= n) return null;
        if (text[j] === c) { if (c !== '`' && text[j + 1] === c) { out += '  '; j += 2; continue; } out += c; j++; break; }
        out += ' '; j++;
      }
      i = j; continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i));
      if (m) { const tag = m[0], end = text.indexOf(tag, i + tag.length); if (end < 0) return null; out += tag + ' '.repeat(end - i - tag.length) + tag; i = end + tag.length; continue; }
    }
    out += c; i++;
  }
  return out;
}

// One statement, checked before it goes anywhere near a database. Reads (SELECT, WITH … SELECT, SHOW, EXPLAIN) pass; a data
// change (INSERT, UPDATE, DELETE) passes only when readOnly is false; DROP, TRUNCATE, ALTER, GRANT, CREATE, a second statement
// or a comment never pass. A SELECT without a LIMIT gets LIMIT 200. Returns { ok, sql, reason, kind } and, for a write that
// touches every row, a warning the CEO reads before approving.
export function validateQuery(sql, { readOnly = true } = {}) {
  const raw = String(sql ?? '');
  const refuse = (reason, kind = 'read') => ({ ok: false, sql: '', reason, kind });
  if (!raw.trim()) return refuse('Refused: the statement is empty.');
  if (raw.length > MAX_SQL_CHARS) return refuse(`Refused: the statement is longer than ${MAX_SQL_CHARS} characters.`);
  const text = raw.trim().replace(/;\s*$/, '');
  const masked = maskLiterals(text);
  if (masked === null) return refuse("Refused: a quote is not closed; write a quote inside a text as two single quotes ('').");
  if (/--|\/\*|\*\/|#/.test(masked)) return refuse('Refused: comments (--, /* */ and #) are not allowed; send the statement without them.');
  if (masked.includes(';')) return refuse('Refused: one statement at a time.');
  const first = (/^[\s(]*([a-z]+)/i.exec(masked)?.[1] || '').toLowerCase(), lower = masked.toLowerCase();
  const kind = WRITE_STARTS.has(first) ? 'write' : READ_STARTS.has(first) ? 'read' : null;
  for (const [pattern, what] of NEVER) if (pattern.test(lower)) return refuse(`Refused: ${what} is never run by an agent. If the change is needed, say so in your report; the CEO makes it.`, kind || 'write');
  if (!kind) return refuse(`Refused: only SELECT, WITH … SELECT, SHOW and EXPLAIN run here${readOnly ? '' : ', and INSERT, UPDATE or DELETE through db_write'}; "${(first || text.slice(0, 20)).toUpperCase()}" is not one of them.`, 'write');
  if (kind === 'read') {
    const hidden = HIDDEN_WRITE.exec(lower);
    if (hidden) return refuse(`Refused: a read statement must not contain ${hidden[1].toUpperCase()}${readOnly ? '; this connection is read-only' : '; a data change goes through db_write'}.`, 'read');
  } else if (readOnly) return refuse(`Refused: this connection is read-only, so ${first.toUpperCase()} is not allowed on it. If the change is needed, say so in your report; the CEO can mark the connection writable under Settings → Vault.`, 'write');
  let out = text;
  if (kind === 'read' && (first === 'select' || first === 'with') && !/\blimit\s+(\d+|all)\b/i.test(masked) && !/\bfetch\s+(first|next)\b/i.test(masked)) out = `${text} LIMIT ${DEFAULT_LIMIT}`;
  const result = { ok: true, sql: out, reason: '', kind };
  if (kind === 'write' && (first === 'update' || first === 'delete') && !/\bwhere\b/i.test(masked)) result.warning = `${first.toUpperCase()} without WHERE changes every row of the table.`;
  return result;
}

/* ---------- the circuit breaker ---------- */
// Three failures in a row open the circuit for a minute: calls are refused at once instead of each waiting for a dead server.
// After the minute one call is let through (half-open); success closes the circuit, failure opens it for another minute.
export class CircuitBreaker {
  constructor({ failures = 3, openMs = 60000, now = Date.now } = {}) { Object.assign(this, { failures, openMs, now, state: 'closed', consecutive: 0, openedAt: 0, probing: false }); }
  status() { if (this.state === 'open' && this.now() - this.openedAt >= this.openMs) { this.state = 'half-open'; this.probing = false; } return this.state; }
  async call(fn) {
    const state = this.status();
    if (state === 'open') throw Object.assign(plain(`This connection is paused after ${this.consecutive} failures in a row; try again in ${Math.max(1, Math.ceil((this.openMs - (this.now() - this.openedAt)) / 1000))} s.`), { code: 'circuit_open' });
    if (state === 'half-open') { if (this.probing) throw Object.assign(plain('This connection is being tested after failures; try again in a moment.'), { code: 'circuit_open' }); this.probing = true; }
    try { const out = await fn(); this.state = 'closed'; this.consecutive = 0; this.probing = false; return out; }
    catch (error) { this.consecutive++; this.probing = false; if (state === 'half-open' || this.consecutive >= this.failures) { this.state = 'open'; this.openedAt = this.now(); } throw error; }
  }
}

/* ---------- what an agent gets back ---------- */
const cellText = value => {
  const s = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : Buffer.isBuffer(value) ? `<${value.length} bytes>` : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return s.length > MAX_CELL_CHARS ? s.slice(0, MAX_CELL_CHARS) + '…' : s;
};
// At most 200 rows and 100 KB of text; a cell is cut at 500 characters. Rows may be arrays (the drivers' array mode) or objects.
export function capResult({ columns = [], rows = [], affected = null, ms = 0 } = {}) {
  const head = columns.length ? columns : rows.length && !Array.isArray(rows[0]) ? Object.keys(rows[0]) : [];
  const out = []; let bytes = head.join('').length, cut = false;
  for (const row of rows) {
    if (out.length >= MAX_ROWS) { cut = true; break; }
    const cells = (Array.isArray(row) ? row : head.map(c => row?.[c])).map(cellText);
    const size = cells.reduce((sum, c) => sum + c.length + 3, 0);
    if (bytes + size > MAX_TEXT_BYTES && out.length) { cut = true; break; }
    bytes += size; out.push(cells);
  }
  return { columns: head, rows: out, rowCount: out.length, truncated: cut || rows.length > out.length, affected: affected ?? null, ms };
}
export function markdownTable({ columns = [], rows = [], rowCount = rows.length, truncated = false, affected = null, ms = 0 } = {}) {
  const esc = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  if (!rows.length) return affected !== null ? `Done: ${affected} row${affected === 1 ? '' : 's'} affected in ${ms} ms.` : `No rows (${ms} ms).`;
  const head = columns.length ? columns : rows[0].map((_, i) => `col${i + 1}`);
  const lines = [`| ${head.map(esc).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${head.map((_, i) => esc(r[i])).join(' | ')} |`)];
  lines.push(`${rowCount} row${rowCount === 1 ? '' : 's'} in ${ms} ms${truncated ? `; the result was cut at ${MAX_ROWS} rows or ${MAX_TEXT_BYTES / 1024} KB: add a WHERE or a smaller LIMIT to see the rest` : ''}.`);
  return lines.join('\n');
}
// Tables and columns as an agent reads them.
export function schemaText(tables = []) {
  if (!tables.length) return 'No tables were found (or this user may not see any).';
  const out = [];
  for (const t of tables) out.push(`### ${t.schema ? t.schema + '.' : ''}${t.name}${t.type === 'view' ? ' (view)' : ''}`, ...t.columns.map(c => `- ${c.name}: ${c.type}${c.nullable ? '' : ', not null'}`));
  return out.join('\n');
}
// information_schema rows (schema, table, table type, column, data type, nullable) grouped into tables, in the order they came.
export function tablesFrom(rows = []) {
  const map = new Map();
  for (const r of rows) {
    const [schema, name, type, column, dataType, nullable] = Array.isArray(r) ? r : Object.values(r);
    const key = `${schema}.${name}`;
    if (!map.has(key)) map.set(key, { schema: String(schema || ''), name: String(name), type: /view/i.test(String(type || '')) ? 'view' : 'table', columns: [] });
    map.get(key).columns.push({ name: String(column), type: String(dataType || ''), nullable: /^(yes|true|1)$/i.test(String(nullable ?? 'yes')) });
  }
  return [...map.values()];
}

/* ---------- the drivers ---------- */
const PG_SCHEMA = "SELECT c.table_schema, c.table_name, t.table_type, c.column_name, c.data_type, c.is_nullable FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY c.table_schema, c.table_name, c.ordinal_position";
const MYSQL_SCHEMA = 'SELECT c.TABLE_SCHEMA, c.TABLE_NAME, t.TABLE_TYPE, c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME WHERE c.TABLE_SCHEMA = DATABASE() ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION';
const timeoutOf = ms => Math.max(1000, Math.round(Number(ms) || DEFAULT_QUERY_TIMEOUT_MS));

// Postgres through pg: a small pool per entry, a read-only session for a read-only entry (a write fails in the server too, whatever
// the validator missed), a statement timeout per query, rows as arrays. A client that failed is dropped from the pool.
export function postgresAdapter(pg, entry) {
  const Pool = pg?.Pool || pg?.default?.Pool; if (typeof Pool !== 'function') throw plain('install pg to use Postgres connections');
  const pool = new Pool({ host: entry.host, port: Number(entry.port) || 5432, user: entry.username, password: entry.secret, database: entry.database, max: 2, connectionTimeoutMillis: 10000, idleTimeoutMillis: 60000, application_name: 'agents-office',
    ...(entry.readOnly !== false ? { options: '-c default_transaction_read_only=on' } : {}), ...(entry.ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
  pool.on?.('error', () => {}); // an idle client the server drops must not crash the office
  const run = async (sql, timeoutMs) => {
    const client = await pool.connect(); let failed = null;
    try {
      await client.query(`SET statement_timeout = ${timeoutOf(timeoutMs)}`);
      const res = await withTimeout(client.query({ text: sql, rowMode: 'array' }), timeoutOf(timeoutMs) + 2000, `The query did not finish within ${Math.round(timeoutOf(timeoutMs) / 1000)} s and was stopped.`);
      return { columns: (res.fields || []).map(f => f.name), rows: res.rows || [], affected: /^(INSERT|UPDATE|DELETE|MERGE)$/i.test(String(res.command || '')) ? res.rowCount ?? 0 : null };
    } catch (error) { failed = error; throw plain(error); } finally { client.release(failed || undefined); }
  };
  return { engine: 'postgres', query: (sql, { timeoutMs } = {}) => run(sql, timeoutMs), schema: async () => tablesFrom((await run(PG_SCHEMA, 30000)).rows), close: () => pool.end() };
}
// MySQL and MariaDB through mysql2: the same shape; a read-only entry gets a read-only session, the query a server-side time limit.
export function mysqlAdapter(mysql, entry) {
  const createPool = mysql?.createPool || mysql?.default?.createPool; if (typeof createPool !== 'function') throw plain('install mysql2 to use MySQL connections');
  const pool = createPool({ host: entry.host, port: Number(entry.port) || 3306, user: entry.username, password: entry.secret, database: entry.database, connectionLimit: 2, connectTimeout: 10000, rowsAsArray: true, ...(entry.ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
  const run = async (sql, timeoutMs) => {
    const conn = await pool.getConnection(); let failed = null;
    try {
      if (entry.readOnly !== false) await conn.query('SET SESSION TRANSACTION READ ONLY').catch(() => {});
      await conn.query(`SET SESSION MAX_EXECUTION_TIME = ${timeoutOf(timeoutMs)}`).catch(() => {});
      const [rows, fields] = await withTimeout(conn.query({ sql, rowsAsArray: true }), timeoutOf(timeoutMs) + 2000, `The query did not finish within ${Math.round(timeoutOf(timeoutMs) / 1000)} s and was stopped.`);
      if (Array.isArray(rows)) return { columns: (fields || []).map(f => f.name), rows, affected: null };
      return { columns: [], rows: [], affected: rows?.affectedRows ?? 0 };
    } catch (error) { failed = error; throw plain(error); } finally { if (failed) conn.destroy?.(); else conn.release(); }
  };
  return { engine: 'mysql', query: (sql, { timeoutMs } = {}) => run(sql, timeoutMs), schema: async () => tablesFrom((await run(MYSQL_SCHEMA, 30000)).rows), close: () => pool.end() };
}

/* ---------- the pool of pools ---------- */
// One lazily created client pool per Vault entry, replaced when the entry changes, each behind its own circuit breaker.
// `drivers` maps an engine to `async entry => adapter` (tests inject fakes); `loaders` import the optional packages.
export class DatabasePool {
  constructor({ drivers = {}, loaders = {}, breaker = {}, now = Date.now } = {}) {
    this.drivers = drivers; this.loaders = { postgres: () => import('pg'), mysql: () => import('mysql2/promise'), ...loaders };
    this.breakerOptions = breaker; this.now = now; this.clients = new Map(); this.breakers = new Map();
  }
  static engineOf(entry) { const e = String(entry?.engine || 'postgres').trim().toLowerCase(); return /^(postgres|postgresql|pg)$/.test(e) ? 'postgres' : /^(mysql|mariadb)$/.test(e) ? 'mysql' : null; }
  breaker(id) { let b = this.breakers.get(id); if (!b) { b = new CircuitBreaker({ ...this.breakerOptions, now: this.now }); this.breakers.set(id, b); } return b; }
  async load(engine) {
    try { return await this.loaders[engine](); }
    catch (error) { if (missingPackage(error)) throw plain(engine === 'postgres' ? 'install pg to use Postgres connections' : 'install mysql2 to use MySQL connections'); throw plain(error); }
  }
  adapter(entry) {
    if (!entry?.id) return Promise.reject(plain('No database connection was named.'));
    const engine = DatabasePool.engineOf(entry); if (!engine) return Promise.reject(plain(`"${entry.engine}" is not a supported engine; the Vault entry must say postgres or mysql.`));
    if (!entry.secret) return Promise.reject(plain(`The Vault entry "${entry.id}" has no password yet.`));
    // The pool is rebuilt when the entry changes; the fingerprint keeps the password out of memory twice.
    const fingerprint = createHash('sha256').update([engine, entry.host, entry.port, entry.database, entry.username, entry.secret, entry.readOnly !== false, !!entry.ssl].join('\n')).digest('hex');
    const have = this.clients.get(entry.id);
    if (have && have.fingerprint === fingerprint) return have.promise;
    if (have) { this.clients.delete(entry.id); have.promise.then(a => a.close()).catch(() => {}); }
    const make = this.drivers[engine] || (async e => { const mod = await this.load(engine); return engine === 'postgres' ? postgresAdapter(mod, e) : mysqlAdapter(mod, e); });
    const promise = Promise.resolve().then(() => make(entry));
    this.clients.set(entry.id, { fingerprint, promise });
    promise.catch(() => { if (this.clients.get(entry.id)?.promise === promise) this.clients.delete(entry.id); });
    return promise;
  }
  // The statement is expected to have passed validateQuery; the caps are applied here regardless.
  async query(entry, sql, { timeoutMs = DEFAULT_QUERY_TIMEOUT_MS } = {}) {
    const started = this.now();
    const res = await this.breaker(entry?.id).call(async () => (await this.adapter(entry)).query(String(sql), { timeoutMs }));
    return capResult({ ...res, ms: Math.max(0, this.now() - started) });
  }
  async schema(entry) { return this.breaker(entry?.id).call(async () => (await this.adapter(entry)).schema()); }
  async close() { const all = [...this.clients.values()]; this.clients.clear(); await Promise.allSettled(all.map(c => c.promise.then(a => a.close()))); }
}
