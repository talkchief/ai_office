import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateQuery, maskLiterals, CircuitBreaker, DatabasePool, postgresAdapter, mysqlAdapter, capResult, markdownTable, MAX_ROWS, MAX_CELL_CHARS } from '../connectors/database.mjs';
import { validateCommand, SshRunner, fingerprintOf, MAX_OUTPUT_CHARS } from '../connectors/ssh.mjs';
import { VaultStore } from '../vault.mjs';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { OfficeEngine, VAULT_APPROVALS } from '../engine/deep-agents.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-connectors-'));
const rm = dir => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
const models = { resolve: () => ({ model: 'x', effort: '' }), instance: async () => null };

test('the query validator lets one read statement through, adds LIMIT 200, and refuses writes, comments, stacked statements and schema changes', () => {
  const ok = (sql, opts) => { const v = validateQuery(sql, opts); assert.equal(v.ok, true, `${sql}: ${v.reason}`); return v; };
  const no = (sql, opts, re) => { const v = validateQuery(sql, opts); assert.equal(v.ok, false, `${sql} should be refused`); if (re) assert.match(v.reason, re, sql); return v; };
  assert.equal(ok('SELECT id, name FROM users WHERE active').sql, 'SELECT id, name FROM users WHERE active LIMIT 200');
  assert.equal(ok('select * from t limit 5;').sql, 'select * from t limit 5', 'a LIMIT is kept and the trailing semicolon dropped');
  assert.equal(ok('SELECT * FROM t OFFSET 5 FETCH FIRST 10 ROWS ONLY').sql, 'SELECT * FROM t OFFSET 5 FETCH FIRST 10 ROWS ONLY');
  assert.equal(ok('WITH recent AS (SELECT * FROM orders) SELECT count(*) FROM recent').sql, 'WITH recent AS (SELECT * FROM orders) SELECT count(*) FROM recent LIMIT 200');
  assert.equal(ok('SHOW TABLES').sql, 'SHOW TABLES'); assert.equal(ok('EXPLAIN SELECT 1').kind, 'read'); assert.equal(ok('(SELECT 1) UNION (SELECT 2)').kind, 'read');
  assert.equal(ok('SELECT * FROM notes WHERE body = \'a; DROP TABLE x -- #1\' AND "drop" = 1').kind, 'read', 'words inside text and quoted names do not count');
  assert.equal(ok('SELECT * FROM t WHERE tag = $$a; drop table t$$').kind, 'read', 'dollar-quoted text is text');
  assert.equal(ok("SELECT REPLACE(name, 'a', 'b'), created_at, deleted_at, last_update FROM executions WHERE lock_version > 1").kind, 'read', 'functions and columns that merely contain a keyword are fine');
  assert.equal(validateQuery("REPLACE INTO t VALUES (1)", { readOnly: false }).kind, 'write'); assert.equal(validateQuery('REPLACE INTO t VALUES (1)').ok, false, 'REPLACE as a statement is a write');
  no('', {}, /empty/); no('x'.repeat(20001), {}, /longer than 20000/);
  no('SELECT 1; DROP TABLE t', {}, /one statement at a time/); no('SELECT 1 -- hide', {}, /comments/); no('SELECT /* x */ 1', {}, /comments/); no('SELECT 1 # x', {}, /comments/);
  no("SELECT 'unterminated", {}, /quote is not closed/);
  for (const sql of ['DROP TABLE users', 'TRUNCATE users', 'ALTER TABLE users ADD x int', 'GRANT ALL ON users TO bob', "CREATE USER bob PASSWORD 'x'", "COPY users TO PROGRAM 'cat'", 'CREATE TABLE t (id int)']) no(sql, { readOnly: false }, /never run by an agent/);
  assert.match(no("COPY users TO PROGRAM 'cat'", { readOnly: false }).reason, /COPY … PROGRAM/);
  no('VACUUM users', {}, /not one of them/); no('SET search_path TO x', {}, /not one of them/); no("COPY users TO '/tmp/x'", { readOnly: false }, /not one of them/);
  assert.equal(no('DELETE FROM users WHERE id = 1', { readOnly: true }, /read-only/).kind, 'write');
  assert.equal(validateQuery('DELETE FROM users WHERE id = 1').ok, false, 'read-only is the default');
  const w = ok('DELETE FROM users WHERE id = 1', { readOnly: false }); assert.equal(w.kind, 'write'); assert.equal(w.sql, 'DELETE FROM users WHERE id = 1'); assert.equal(w.warning, undefined);
  assert.match(ok('UPDATE users SET active = false', { readOnly: false }).warning, /without WHERE changes every row/);
  assert.equal(ok("INSERT INTO t VALUES (nextval('s'))", { readOnly: false }).kind, 'write');
  no('WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d', { readOnly: false }, /must not contain DELETE/);
  no('SELECT * FROM t FOR UPDATE', {}, /UPDATE/); no('SELECT pg_sleep(10)', {}, /blocked function/); no("SELECT * FROM t INTO OUTFILE '/tmp/x'", {}, /INTO OUTFILE/); no('SELECT * INTO t2 FROM t', {}, /INTO/);
  assert.equal(maskLiterals("a 'b''c' d"), "a '    ' d"); assert.equal(maskLiterals("'open"), null); assert.equal(maskLiterals('`x#y` #'), '`   ` #');
});

test('the circuit breaker opens after three failures in a row, refuses calls for a minute, then lets one probe through', async () => {
  let now = 1000, calls = 0; const b = new CircuitBreaker({ now: () => now });
  const boom = async () => { calls++; throw new Error('down'); };
  for (let i = 0; i < 3; i++) await assert.rejects(() => b.call(boom), /down/);
  assert.equal(b.status(), 'open');
  await assert.rejects(() => b.call(boom), /paused after 3 failures in a row; try again in 60 s/); assert.equal(calls, 3, 'an open circuit does not call the server');
  now += 59000; await assert.rejects(() => b.call(boom), /try again in 1 s/);
  now += 1000; assert.equal(b.status(), 'half-open');
  await assert.rejects(() => b.call(boom), /down/); assert.equal(b.status(), 'open', 'a failure while half-open reopens it'); assert.equal(calls, 4);
  now += 60000;
  let release; const probe = b.call(() => new Promise(resolve => { release = resolve; }));
  await assert.rejects(() => b.call(boom), /being tested/); release('ok'); assert.equal(await probe, 'ok'); assert.equal(b.status(), 'closed');
  await assert.rejects(() => b.call(boom), /down/); assert.equal(b.status(), 'closed', 'one failure after recovery does not reopen it');
});

function fakeDriver(log, { rows = [[1, 'a']], columns = ['id', 'name'], fail = false } = {}) {
  return async entry => {
    log.push({ made: entry.id });
    return {
      query: async (sql, { timeoutMs }) => { log.push({ sql, timeoutMs }); if (fail) throw new Error('connection refused'); return { columns, rows, affected: null }; },
      schema: async () => [{ schema: 'public', name: 'users', type: 'table', columns: [{ name: 'id', type: 'integer', nullable: false }] }],
      close: async () => { log.push({ closed: entry.id }); },
    };
  };
}

test('the pool builds one client per Vault entry when first used, rebuilds it when the entry changes, caps what comes back and closes everything', async () => {
  const log = [], pool = new DatabasePool({ drivers: { postgres: fakeDriver(log, { rows: Array.from({ length: 250 }, (_, i) => [i, 'x'.repeat(600)]) }) } });
  const entry = { id: 'crm', engine: 'postgres', host: 'h', port: 5432, database: 'crm', username: 'u', secret: 'pw', readOnly: true };
  const r = await pool.query(entry, 'SELECT * FROM users LIMIT 300', { timeoutMs: 1234 });
  assert.equal(r.rows.length, MAX_ROWS); assert.equal(r.rowCount, MAX_ROWS); assert.equal(r.truncated, true); assert.deepEqual(r.columns, ['id', 'name']);
  assert.equal(r.rows[0][1].length, MAX_CELL_CHARS + 1); assert.ok(r.rows[0][1].endsWith('…'), 'a long cell is cut'); assert.equal(log[1].timeoutMs, 1234);
  await pool.query(entry, 'SELECT 1'); assert.equal(log.filter(l => l.made).length, 1, 'the client is made once');
  assert.equal((await pool.schema(entry))[0].name, 'users');
  await pool.query({ ...entry, secret: 'pw2' }, 'SELECT 2'); assert.equal(log.filter(l => l.made).length, 2, 'a changed entry gets a new client'); assert.ok(log.some(l => l.closed === 'crm'), 'and the old one is closed');
  await assert.rejects(() => pool.query({ ...entry, engine: 'oracle' }, 'SELECT 1'), /not a supported engine/);
  await assert.rejects(() => pool.query({ ...entry, secret: '' }, 'SELECT 1'), /no password yet/);
  await pool.close(); assert.equal(log.filter(l => l.closed).length, 2);
  // The caps and the table on their own: 100 KB of text, object rows, a pipe in a cell.
  const big = capResult({ columns: ['a', 'b', 'c'], rows: Array.from({ length: 150 }, () => ['y'.repeat(1000), 'y'.repeat(1000), 'y'.repeat(1000)]) });
  assert.ok(big.rows.length < 80 && big.rows.length > 50, `${big.rows.length} rows of three cut cells fit in 100 KB`); assert.equal(big.truncated, true);
  const objects = capResult({ rows: [{ id: 1, note: 'a|b' }] }); assert.deepEqual(objects.columns, ['id', 'note']);
  assert.equal(markdownTable({ ...objects, ms: 5 }), '| id | note |\n| --- | --- |\n| 1 | a\\|b |\n1 row in 5 ms.');
  assert.equal(markdownTable({ columns: [], rows: [], affected: 3, ms: 2 }), 'Done: 3 rows affected in 2 ms.');
});

test('a database that keeps failing is paused: after three failures the pool refuses at once, and a missing driver is one plain sentence', async () => {
  const log = [], missing = name => async () => { throw Object.assign(new Error(`Cannot find package '${name}' imported from x`), { code: 'ERR_MODULE_NOT_FOUND' }); };
  const pool = new DatabasePool({ drivers: { postgres: fakeDriver(log, { fail: true }) }, loaders: { mysql: missing('mysql2') } });
  const entry = { id: 'crm', engine: 'postgres', host: 'h', port: 1, database: 'd', username: 'u', secret: 'pw' };
  for (let i = 0; i < 3; i++) await assert.rejects(() => pool.query(entry, 'SELECT 1'), /connection refused/);
  await assert.rejects(() => pool.query(entry, 'SELECT 1'), /paused after 3 failures/); assert.equal(log.filter(l => l.sql).length, 3, 'the fourth call never reached the driver');
  await assert.rejects(() => pool.query({ ...entry, id: 'shop', engine: 'mysql' }, 'SELECT 1'), /^Error: install mysql2 to use MySQL connections$/);
  await assert.rejects(() => new DatabasePool({ loaders: { postgres: missing('pg') } }).schema(entry), /^Error: install pg to use Postgres connections$/);
  await pool.close();
});

test('the Postgres and MySQL drivers get a read-only session, a statement timeout and rows as arrays, and drop a client that failed', async () => {
  const schemaRows = [['public', 'users', 'BASE TABLE', 'id', 'integer', 'NO'], ['public', 'users', 'BASE TABLE', 'email', 'text', 'YES'], ['public', 'v_users', 'VIEW', 'id', 'integer', 'YES']];
  const pg = { calls: [], released: [], Pool: class {
    constructor(cfg) { pg.config = cfg; } on() {}
    async connect() { return { query: async q => { pg.calls.push(q); if (typeof q === 'string') return {}; if (q.text.includes('boom')) throw new Error('syntax error near boom'); if (q.text.includes('information_schema')) return { command: 'SELECT', rows: schemaRows, fields: [] }; return { command: q.text.startsWith('INSERT') ? 'INSERT' : 'SELECT', rowCount: 1, fields: [{ name: 'id' }], rows: [[1]] }; }, release: err => pg.released.push(err) }; }
    async end() { pg.ended = true; }
  } };
  const entry = { id: 'crm', host: 'h', port: 5432, username: 'u', secret: 'pw', database: 'crm', readOnly: true };
  const a = postgresAdapter(pg, entry);
  assert.equal(pg.config.options, '-c default_transaction_read_only=on', 'a read-only entry gets a read-only session'); assert.equal(pg.config.password, 'pw'); assert.equal(pg.config.max, 2);
  assert.deepEqual(await a.query('SELECT 1', { timeoutMs: 5000 }), { columns: ['id'], rows: [[1]], affected: null });
  assert.equal(pg.calls[0], 'SET statement_timeout = 5000'); assert.deepEqual(pg.calls[1], { text: 'SELECT 1', rowMode: 'array' }); assert.equal(pg.released.at(-1), undefined, 'a healthy client goes back to the pool');
  assert.equal((await a.query('INSERT INTO t VALUES (1)', {})).affected, 1);
  await assert.rejects(() => a.query('SELECT boom', {}), /^Error: syntax error near boom$/); assert.ok(pg.released.at(-1) instanceof Error, 'the failed client is dropped from the pool');
  assert.deepEqual(await a.schema(), [{ schema: 'public', name: 'users', type: 'table', columns: [{ name: 'id', type: 'integer', nullable: false }, { name: 'email', type: 'text', nullable: true }] }, { schema: 'public', name: 'v_users', type: 'view', columns: [{ name: 'id', type: 'integer', nullable: true }] }]);
  await a.close(); assert.equal(pg.ended, true);
  postgresAdapter(pg, { ...entry, readOnly: false }); assert.equal('options' in pg.config, false, 'a writable entry gets an ordinary session');
  const my = { calls: [], released: 0, destroyed: 0, createPool: cfg => { my.config = cfg; return {
    getConnection: async () => ({ query: async q => { my.calls.push(q); const sql = typeof q === 'string' ? q : q.sql; if (sql.startsWith('SET')) return [{}]; if (sql.includes('boom')) throw new Error('You have an error near boom'); if (sql.startsWith('UPDATE')) return [{ affectedRows: 3 }, undefined]; return [[[1, 'a']], [{ name: 'id' }, { name: 'name' }]]; }, release: () => my.released++, destroy: () => my.destroyed++ }),
    end: async () => { my.ended = true; } }; } };
  const m = mysqlAdapter(my, { id: 'shop', host: 'h', port: 3306, username: 'u', secret: 'pw', database: 'shop', readOnly: true });
  assert.equal(my.config.rowsAsArray, true); assert.equal(my.config.connectionLimit, 2);
  assert.deepEqual(await m.query('SELECT 1', { timeoutMs: 4000 }), { columns: ['id', 'name'], rows: [[1, 'a']], affected: null });
  assert.deepEqual(my.calls, ['SET SESSION TRANSACTION READ ONLY', 'SET SESSION MAX_EXECUTION_TIME = 4000', { sql: 'SELECT 1', rowsAsArray: true }]); assert.equal(my.released, 1);
  assert.equal((await m.query('UPDATE t SET a = 1', {})).affected, 3);
  await assert.rejects(() => m.query('SELECT boom', {}), /near boom/); assert.equal(my.destroyed, 1, 'a failed connection is destroyed, not returned');
  await m.close(); assert.equal(my.ended, true);
});

test('the SSH command validator refuses empty, long, multi-line and destructive commands, and enforces a target’s allowed prefixes', () => {
  const ok = (c, e) => { const v = validateCommand(c, e); assert.equal(v.ok, true, `${c}: ${v.reason}`); return v; };
  const no = (c, e, re) => { const v = validateCommand(c, e); assert.equal(v.ok, false, `${c} should be refused`); if (re) assert.match(v.reason, re, c); };
  assert.equal(ok('  uptime ').command, 'uptime'); ok('ls -la /var/log | head -20'); ok('rm -rf ./build'); ok('rm -rf /tmp/build'); ok('git pull; echo done', {});
  no('', {}, /empty/); no('x'.repeat(2001), {}, /longer than 2000/); no('ls\nrm -rf /', {}, /one command per call/);
  for (const c of ['rm -rf /', 'sudo rm -rf /*', 'rm --no-preserve-root -rf /', 'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/sda', 'shutdown -h now', 'sudo reboot', ':(){ :|:& };:', 'cat x > /dev/sda', 'chmod -R 777 /', 'wipefs -a /dev/sdb']) no(c, {}, /never run by an agent/);
  const entry = { allow: ['git pull', 'systemctl status'] };
  ok('git pull origin main', entry); ok('systemctl status nginx', entry); ok('git pull', entry);
  no('git push origin main', entry, /only runs commands that start with: git pull · systemctl status/); no('git pullx', entry, /start with/);
  no('git pull; rm -rf ~', entry, /without ; & \|/); no('systemctl status nginx | grep active', entry, /without/); no('git pull $(id)', entry, /without/);
});

function fakeSsh2({ code = 0, stdout = 'ok\n', stderr = '', hang = false, connectError = null } = {}, seen = {}) {
  class Client {
    constructor() { this.handlers = {}; }
    on(event, fn) { this.handlers[event] = fn; return this; }
    connect(cfg) { seen.connect = cfg; setTimeout(() => connectError ? this.handlers.error?.(new Error(connectError)) : this.handlers.ready?.(), 0); }
    exec(command, cb) {
      seen.command = command;
      const stream = { handlers: {}, errHandlers: {}, on(e, fn) { stream.handlers[e] = fn; return stream; }, stderr: { on(e, fn) { stream.errHandlers[e] = fn; return stream.stderr; } } };
      cb(null, stream);
      setTimeout(() => { if (stdout) stream.handlers.data?.(Buffer.from(stdout)); if (stderr) stream.errHandlers.data?.(Buffer.from(stderr)); if (!hang) stream.handlers.close?.(code, null); }, 0);
    }
    end() { seen.ended = (seen.ended || 0) + 1; }
  }
  return { Client };
}

test('the SSH runner connects with the entry’s key or password, returns the exit code and capped output, stops a command that hangs, and names a missing driver plainly', async () => {
  const seen = {}, runner = new SshRunner({ loader: async () => fakeSsh2({ stdout: 'x'.repeat(MAX_OUTPUT_CHARS + 10), stderr: 'warn' }, seen) });
  const key = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----';
  const r = await runner.run({ id: 'web-1', host: '10.0.0.5', port: 22, username: 'deploy', secret: key }, 'git pull', { timeoutMs: 5000 });
  assert.equal(seen.connect.privateKey, key); assert.equal(seen.connect.password, undefined); assert.equal(seen.connect.username, 'deploy'); assert.equal(seen.connect.port, 22); assert.equal(seen.command, 'git pull');
  assert.equal(r.code, 0); assert.equal(r.stdout.length, MAX_OUTPUT_CHARS); assert.equal(r.truncated, true); assert.equal(r.stderr, 'warn'); assert.ok(r.ms >= 0); assert.equal(r.timedOut, false); assert.equal(seen.ended, 1, 'the connection is closed after the command');
  const pw = {}, byPassword = new SshRunner({ loader: async () => fakeSsh2({ code: 2, stdout: '', stderr: 'no such unit' }, pw) });
  const r2 = await byPassword.run({ id: 'web-2', host: 'h', username: 'root', secret: 'hunter22', fingerprint: 'SHA256:abc' }, 'systemctl status nginx');
  assert.equal(pw.connect.password, 'hunter22'); assert.equal(pw.connect.privateKey, undefined); assert.equal(pw.connect.tryKeyboard, true);
  assert.equal(typeof pw.connect.hostVerifier, 'function'); assert.equal(pw.connect.hostVerifier(Buffer.from('some key')), false, 'a pinned fingerprint refuses another key');
  assert.equal(r2.code, 2); assert.equal(r2.stderr, 'no such unit'); assert.equal(r2.truncated, false);
  assert.match(fingerprintOf(Buffer.from('key')), /^SHA256:[A-Za-z0-9+/]{43}$/);
  const hung = {}, slow = new SshRunner({ loader: async () => fakeSsh2({ hang: true, stdout: 'partial' }, hung) });
  const r3 = await slow.run({ id: 'w', host: 'h', username: 'u', secret: 'pw' }, 'sleep 100', { timeoutMs: 100 });
  assert.equal(r3.timedOut, true); assert.equal(r3.code, null); assert.equal(r3.stdout, 'partial'); assert.match(r3.stderr, /stopped after/); assert.equal(hung.ended, 1, 'a hung command is cut off');
  const refused = new SshRunner({ loader: async () => fakeSsh2({ connectError: 'All configured authentication methods failed' }) });
  await assert.rejects(() => refused.run({ id: 'w', host: 'h', username: 'u', secret: 'pw' }, 'uptime'), /authentication methods failed/);
  const none = new SshRunner({ loader: async () => { throw Object.assign(new Error("Cannot find package 'ssh2'"), { code: 'ERR_MODULE_NOT_FOUND' }); } });
  await assert.rejects(() => none.run({ id: 'w', host: 'h', secret: 'pw' }, 'uptime'), /^Error: install ssh2 to use SSH targets$/);
  await assert.rejects(() => none.run({ id: 'w', host: 'h', secret: '' }, 'uptime'), /no key or password yet/);
});

test('a database entry in the Vault is read-only unless the CEO says otherwise, and an SSH entry may carry allowed command prefixes and a host key fingerprint', () => {
  const dir = temp(), vault = new VaultStore({ dataDir: dir });
  const db = vault.upsert({ id: 'crm-db', kind: 'database', host: 'db', database: 'crm', username: 'r', secret: 'pw' });
  assert.equal(db.readOnly, true); assert.equal(db.engine, 'postgres'); assert.equal(db.port, 5432);
  assert.equal(vault.upsert({ id: 'crm-db', readOnly: false }).readOnly, false); assert.equal(vault.upsert({ id: 'crm-db', name: 'CRM' }).readOnly, false, 'an edit that does not mention it keeps the choice');
  assert.equal(vault.upsert({ id: 'crm-db', readOnly: 'false' }).readOnly, false); assert.equal(vault.upsert({ id: 'crm-db', readOnly: true }).readOnly, true);
  const shop = vault.upsert({ id: 'shop', kind: 'database', engine: 'MySQL', host: 'db', database: 'shop', secret: 'pw' }); assert.equal(shop.engine, 'mysql'); assert.equal(shop.port, 3306, 'MySQL defaults to 3306');
  assert.throws(() => vault.upsert({ id: 'ora', kind: 'database', engine: 'oracle', host: 'db', secret: 'pw' }), /Engine must be postgres or mysql/);
  const ssh = vault.upsert({ id: 'web-1', kind: 'ssh', host: '10.0.0.5', username: 'deploy', secret: 'pw', allow: ['git pull', ' systemctl status ', '', 'git pull'], fingerprint: ' SHA256:abc ' });
  assert.deepEqual(ssh.allow, ['git pull', 'systemctl status']); assert.equal(ssh.fingerprint, 'SHA256:abc');
  assert.deepEqual(vault.upsert({ id: 'web-1', allow: 'uptime\ndf -h\n' }).allow, ['uptime', 'df -h'], 'one prefix per line is accepted too');
  assert.deepEqual(vault.upsert({ id: 'web-1', name: 'Web' }).allow, ['uptime', 'df -h']); assert.deepEqual(vault.upsert({ id: 'web-1', allow: [] }).allow, []);
  assert.equal('readOnly' in vault.upsert({ id: 'api', kind: 'api', baseURL: 'https://x.example/v1' }), false);
  rm(dir);
});

function fakes() {
  const log = { queries: [], schemas: [], commands: [] };
  const pool = {
    query: async (entry, sql, opts) => {
      log.queries.push({ id: entry.id, sql, timeoutMs: opts.timeoutMs });
      if (/boom/.test(sql)) throw new Error('relation "boom" does not exist');
      if (/^(INSERT|UPDATE|DELETE)/i.test(sql)) return { columns: [], rows: [], rowCount: 0, truncated: false, affected: 2, ms: 3 };
      return { columns: ['id', 'email', 'token'], rows: [[1, 'a@x.io', 'pw-secret-12345'], [2, 'b@x.io', 'x']], rowCount: 2, truncated: false, affected: null, ms: 7 };
    },
    schema: async entry => { log.schemas.push(entry.id); return [{ schema: 'public', name: 'users', type: 'table', columns: [{ name: 'id', type: 'integer', nullable: false }, { name: 'email', type: 'text', nullable: true }] }]; },
    close: async () => { log.closed = true; },
  };
  const ssh = { run: async (entry, command) => { log.commands.push({ id: entry.id, command }); return { code: 0, stdout: 'pulled with key pw-secret-12345\n', stderr: '', ms: 12, timedOut: false, truncated: false }; } };
  return { log, pool, ssh };
}

test('agents reach a database or a server through the office: team-limited entries are hidden, reads run, writes need a writable entry and the CEO, output is masked and every call is on the timeline', async () => {
  const dir = temp(), vault = new VaultStore({ dataDir: dir });
  vault.upsert({ id: 'crm-db', kind: 'database', host: 'db.internal', database: 'crm', username: 'reader', secret: 'pw-secret-12345', teams: ['sales'] });
  vault.upsert({ id: 'ops-db', kind: 'database', engine: 'mysql', host: 'db.internal', database: 'ops', username: 'writer', secret: 'pw-secret-12345', readOnly: false, notes: 'The operations ledger.' });
  vault.upsert({ id: 'web-1', kind: 'ssh', host: '10.0.0.5', username: 'deploy', secret: 'pw-secret-12345', allow: ['git pull', 'systemctl status'] });
  vault.upsert({ id: 'bare', kind: 'ssh', host: '10.0.0.6', username: 'root' });
  const office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  const { log, pool, ssh } = fakes();
  const engine = new OfficeEngine({ dataDir: dir, office, models, knowledgeDir: path.join(dir, 'knowledge'), vault, settings: () => ({}), connectors: { pool, ssh } });
  try {
    const job = engine.create({ dept: 'marketing', text: 'Count the users.', autoStart: false });
    const tools = engine.connectorTools(job.id, office.team('marketing'), 'mlead');
    assert.deepEqual(tools.map(t => t.name), ['db_list', 'db_schema', 'db_query', 'db_write', 'ssh_list', 'ssh_run']);
    assert.deepEqual(Object.keys(VAULT_APPROVALS), ['api_request', 'api_upload', 'db_write', 'ssh_run'], 'a data change and a command pause for the CEO; reads do not');
    const [dbList, dbSchema, dbQuery, dbWrite, sshList, sshRun] = tools;
    const listed = await dbList.invoke({});
    assert.match(listed, /ops-db \(ops-db\): mysql database "ops" at db\.internal:3306 as writer, writable \(db_write pauses for the CEO\): The operations ledger\./);
    assert.ok(!listed.includes('crm-db'), 'a connection limited to Sales is not offered to Marketing'); assert.ok(!listed.includes('pw-secret'));
    assert.match(await dbQuery.invoke({ database: 'crm-db', sql: 'SELECT 1' }), /not a database connection in the Vault for your team/);
    assert.match(await dbSchema.invoke({ database: 'ops-db' }), /### public\.users\n- id: integer, not null\n- email: text/); assert.deepEqual(log.schemas, ['ops-db']);
    const rows = await dbQuery.invoke({ database: 'ops-db', sql: 'SELECT id, email, token FROM users' });
    assert.equal(log.queries[0].sql, 'SELECT id, email, token FROM users LIMIT 200', 'the office adds the LIMIT'); assert.equal(log.queries[0].timeoutMs, 15000);
    assert.match(rows, /\| id \| email \| token \|\n\| --- \| --- \| --- \|\n\| 1 \| a@x\.io \| \[secret\] \|\n\| 2 \| b@x\.io \| x \|\n2 rows in 7 ms\./); assert.ok(!rows.includes('pw-secret'), 'a password echoed by the database is masked');
    assert.match(await dbQuery.invoke({ database: 'ops-db', sql: 'DELETE FROM users WHERE id = 1' }), /Call db_write with it/);
    assert.match(await dbQuery.invoke({ database: 'ops-db', sql: 'SELECT 1; DROP TABLE users' }), /one statement at a time/);
    assert.equal(await dbQuery.invoke({ database: 'ops-db', sql: 'SELECT * FROM boom' }), 'The query on ops-db failed: relation "boom" does not exist');
    vault.upsert({ id: 'crm-db', teams: [] });
    assert.match(await dbWrite.invoke({ database: 'crm-db', sql: 'DELETE FROM users WHERE id = 1' }), /"crm-db" is read-only/);
    assert.match(await dbWrite.invoke({ database: 'ops-db', sql: 'DROP TABLE users', why: 'cleanup' }), /DROP is never run by an agent/);
    assert.match(await dbWrite.invoke({ database: 'ops-db', sql: 'SELECT 1' }), /db_write is for one INSERT, UPDATE or DELETE/);
    assert.equal(await dbWrite.invoke({ database: 'ops-db', sql: 'UPDATE users SET active = false WHERE id = 2', why: 'Deactivate a leaver' }), 'Done: 2 rows affected in 3 ms.');
    assert.equal(log.queries.at(-1).sql, 'UPDATE users SET active = false WHERE id = 2'); assert.equal(log.queries.at(-1).timeoutMs, 30000);
    const targets = await sshList.invoke({});
    assert.match(targets, /web-1 \(web-1\): deploy@10\.0\.0\.5:22, password stored, commands allowed: git pull, systemctl status/); assert.match(targets, /bare \(bare\): root@10\.0\.0\.6:22, no key or password yet, any command/);
    assert.match(await sshRun.invoke({ target: 'web-1', command: 'rm -rf /' }), /never run by an agent/);
    assert.match(await sshRun.invoke({ target: 'web-1', command: 'git push' }), /only runs commands that start with: git pull · systemctl status/);
    assert.match(await sshRun.invoke({ target: 'bare', command: 'uptime' }), /no key or password yet/);
    assert.equal(await sshRun.invoke({ target: 'web-1', command: 'git pull origin main' }), 'Exit code 0 (12 ms).\nOutput:\npulled with key [secret]');
    assert.deepEqual(log.commands, [{ id: 'web-1', command: 'git pull origin main' }]);
    assert.match(await sshRun.invoke({ target: 'nope', command: 'uptime' }), /not an SSH target in the Vault for your team/);
    const events = engine.events(job.id).filter(e => e.type === 'connector_called');
    assert.ok(events.length >= 7, `${events.length} connector events`);
    assert.ok(events.every(e => e.agent === 'mlead' && !JSON.stringify(e).includes('pw-secret')), 'no event carries a secret');
    assert.ok(events.some(e => e.message === 'db_write ops-db: UPDATE users SET active = false WHERE id = 2 → 2 rows in 3 ms (Deactivate a leaver)'), events.map(e => e.message).join(' | '));
    assert.ok(events.some(e => e.message === 'ssh_run web-1: git pull origin main → exit 0 in 12 ms'));
    // Without a Vault there are no connector tools; without the optional packages the tools answer with a sentence, they never throw.
    const bare = new OfficeEngine({ dataDir: path.join(dir, 'bare'), office, models, knowledgeDir: path.join(dir, 'knowledge'), settings: () => ({}), connectors: { pool, ssh } });
    assert.deepEqual(bare.connectorTools(job.id, office.team('marketing'), 'mlead'), []); await bare.close();
    const absent = message => async () => { throw new Error(message); };
    const without = new OfficeEngine({ dataDir: path.join(dir, 'without'), office, models, knowledgeDir: path.join(dir, 'knowledge'), vault, settings: () => ({}), connectors: { pool: { query: absent('install pg to use Postgres connections'), schema: absent('install pg to use Postgres connections'), close: async () => {} }, ssh: { run: absent('install ssh2 to use SSH targets') } } });
    const w = without.connectorTools(job.id, office.team('marketing'), 'mlead');
    assert.equal(await w[1].invoke({ database: 'ops-db' }), 'Reading the tables of ops-db failed: install pg to use Postgres connections');
    assert.equal(await w[2].invoke({ database: 'ops-db', sql: 'SELECT 1' }), 'The query on ops-db failed: install pg to use Postgres connections');
    assert.equal(await w[5].invoke({ target: 'web-1', command: 'git pull' }), 'The command on web-1 failed: install ssh2 to use SSH targets');
    await without.close();
  } finally { await engine.close(); assert.equal(log.closed, true, 'closing the office closes the database clients'); rm(dir); }
});

test('leads and specialists carry the connector tools, and db_write and ssh_run pause for the CEO while reads do not', async () => {
  const dir = temp(), vault = new VaultStore({ dataDir: dir }), office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents }), built = [];
  const engine = new OfficeEngine({ dataDir: dir, office, models, knowledgeDir: path.join(dir, 'knowledge'), vault, settings: () => ({}), connectors: fakes(), agentFactory: cfg => { built.push(cfg); return { name: cfg.name }; } });
  try {
    const job = engine.create({ dept: 'marketing', text: 'Count the users.', autoStart: false });
    await engine.build(job, new AbortController().signal);
    const lead = built.find(c => c.name === 'lead-marketing'), names = lead.tools.map(t => t.name);
    for (const n of ['db_list', 'db_schema', 'db_query', 'db_write', 'ssh_list', 'ssh_run']) assert.ok(names.includes(n), `the lead has ${n}`);
    assert.deepEqual(lead.interruptOn.db_write, { allowedDecisions: ['approve', 'edit', 'reject'] }); assert.deepEqual(lead.interruptOn.ssh_run, { allowedDecisions: ['approve', 'edit', 'reject'] });
    assert.equal(lead.interruptOn.db_query, undefined, 'a read runs at once');
    const specialist = lead.subagents[0], specialistNames = specialist.tools.map(t => t.name);
    for (const n of ['db_query', 'db_write', 'ssh_run']) assert.ok(specialistNames.includes(n), `a specialist has ${n}`);
    assert.ok(specialist.interruptOn.ssh_run && specialist.interruptOn.db_write && !specialist.interruptOn.db_list);
    const pm = built.find(c => c.name === 'program-manager'); assert.ok(!pm.tools.some(t => t.name === 'db_query'), 'the Program Manager delegates; it does not query');
  } finally { await engine.close(); rm(dir); }
});
