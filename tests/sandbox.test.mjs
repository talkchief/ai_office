import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LIMITS, SKIP_DIRS, validPackages, validCommand, safeRelative, runArgs, execArgs, installArgs, commandSeconds } from '../sandbox/rules.mjs';
import { FakeBroker, TaskSandboxes, scanWorkspace, writeBack, sandboxTools, SANDBOX_APPROVALS } from '../engine/sandbox.mjs';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { OfficeEngine } from '../engine/deep-agents.mjs';
import { specialistPrompt, leadPrompt, quickLeadPrompt, programManagerPrompt } from '../engine/prompts.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-sandbox-'));
const rm = dir => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
const canLink = (() => { const d = temp(); try { fs.writeFileSync(path.join(d, 't'), 'x'); fs.symlinkSync(path.join(d, 't'), path.join(d, 'l')); return true; } catch { return false; } finally { rm(d); } })();

test('the rules: a fixed container profile, plain package names, plain paths, bounded commands', () => {
  const run = runArgs({ office: 't_abc', task: 'job-1', image: 'localhost/ao-sandbox:test' });
  for (const flag of [['--network', 'none'], ['--cap-drop', 'ALL'], ['--security-opt', 'no-new-privileges'], ['--user', '1000:1000'], ['--memory', '1g'], ['--pids-limit', '256']]) assert.ok(run.join(' ').includes(flag.join(' ')), flag.join(' '));
  assert.ok(run.includes('--read-only')); assert.ok(!run.some(a => /^--privileged|^--volume|^-v$|type=bind|^host$|--network=host|^--pid$|^--ipc$/.test(a)), 'no privilege, no host mount, no host network');
  assert.ok(run.includes('type=volume,src=ao-t_abc-job-1-work,dst=/work,U=true') && run.includes('type=volume,src=ao-t_abc-job-1-deps,dst=/deps,ro=true'));
  assert.deepEqual(execArgs({ office: 't_abc', task: 'job-1', command: 'python3 x.py', seconds: 300 }).slice(-7), ['timeout', '-k', '5', '300', 'bash', '-c', 'python3 x.py'], 'the command runs under timeout');
  const pip = installArgs({ office: 't_abc', task: 'job-1', manager: 'pip', packages: ['pandas==2.2.2'] }).join(' ');
  assert.match(pip, /--only-binary=:all:/); assert.match(pip, /--index-url https:\/\/pypi\.org\/simple/); assert.doesNotMatch(pip, /-work|dst=\/work/, 'the install helper never sees the task’s files'); assert.doesNotMatch(pip, /--network none/, 'it has the network');
  assert.match(installArgs({ office: 't_abc', task: 'job-1', manager: 'npm', packages: ['left-pad'] }).join(' '), /--ignore-scripts/);
  assert.deepEqual(validPackages('pip', ['pandas', 'python-dateutil==2.8.2', 'requests[socks]>=2.31']), { packages: ['pandas', 'python-dateutil==2.8.2', 'requests[socks]>=2.31'] });
  assert.deepEqual(validPackages('npm', ['@scope/name@1.0.0', 'left-pad']), { packages: ['@scope/name@1.0.0', 'left-pad'] });
  for (const bad of [['git+https://github.com/x/y'], ['https://evil.example/pkg.whl'], ['../local'], ['-r requirements.txt'], ['--index-url=http://x'], ['pkg; rm -rf /'], ['file:./x']]) assert.ok(validPackages('pip', bad).error, bad[0]);
  assert.ok(validPackages('apt', ['curl']).error); assert.ok(validPackages('pip', Array.from({ length: 41 }, (_, i) => `p${i}`)).error);
  assert.equal(safeRelative('a/b.txt'), 'a/b.txt'); for (const bad of ['/etc/passwd', '../x', 'a/../../x', 'a//b', './a', 'a\\b', '']) assert.equal(safeRelative(bad), null, bad);
  assert.ok(validCommand('')); assert.ok(validCommand('x'.repeat(LIMITS.commandChars + 1))); assert.equal(validCommand('python3 build.py'), '');
  assert.equal(commandSeconds(undefined), 300); assert.equal(commandSeconds(60), LIMITS.commandMinutesMax * 60); assert.equal(commandSeconds(0.2), 60);
  assert.ok(SKIP_DIRS.includes('node_modules') && SKIP_DIRS.includes('.git'));
});

function sandboxes({ run, settings = {}, allowed = true, broker } = {}) {
  const dir = temp(), events = [], records = new Map(), fake = broker || new FakeBroker({ run });
  const box = new TaskSandboxes({ client: fake, office: 'office', workspaceDir: id => path.join(dir, id), settings: () => ({ sandbox: true, sandboxCommandMinutes: 5, sandboxIdleMinutes: 20, ...settings }), allowed: () => allowed,
    event: (id, type, agent, message) => events.push({ id, type, agent, message }), record: (id, fn) => { const j = records.get(id) || {}; fn(j); records.set(id, j); } });
  return { box, fake, dir, events, records, ws: id => path.join(dir, id) };
}

test('a command runs on a copy of /work/, and only plain files come back', async () => {
  const s = sandboxes({ run: ({ command, box }) => {
    if (command === 'python3 build.py') {
      assert.equal(box.read('inbox/data.csv'), 'month,revenue\nJan,10\n', 'the attached file was copied in');
      box.write('out/board-deck.pptx', 'PPTX-BYTES'); box.write('charts/revenue.png', 'PNG');
      box.special('evil', 'link'); box.special('pipe', 'fifo');
      box.write('node_modules/left-pad/index.js', 'cache');
      return { exitCode: 0, stdout: 'deck written', stderr: '' };
    }
    return { exitCode: 0 };
  } });
  try {
    const ws = s.ws('job-1'); fs.mkdirSync(path.join(ws, 'inbox'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'inbox', 'data.csv'), 'month,revenue\nJan,10\n'); fs.writeFileSync(path.join(ws, 'build.py'), 'print("deck written")');
    const answer = await s.box.run('job-1', { command: 'python3 build.py', agent: 'ana' });
    assert.match(answer, /^\$ python3 build\.py\nExit code 0 in 1\.2 s\./);
    assert.match(answer, /Copied back to \/work\/: (out\/board-deck\.pptx \(10 bytes\), charts\/revenue\.png \(3 bytes\)|charts\/revenue\.png \(3 bytes\), out\/board-deck\.pptx \(10 bytes\))\./);
    assert.match(answer, /Not copied back: evil \(a link\), pipe \(a pipe\)\. Only plain files come back\./);
    assert.match(answer, /Output:\ndeck written/);
    assert.equal(fs.readFileSync(path.join(ws, 'out', 'board-deck.pptx'), 'utf8'), 'PPTX-BYTES');
    assert.equal(fs.existsSync(path.join(ws, 'evil')) || fs.existsSync(path.join(ws, 'pipe')), false, 'no link or pipe reaches the workspace');
    assert.equal(fs.existsSync(path.join(ws, 'node_modules')), false, 'dependencies stay in the sandbox');
    assert.deepEqual(s.events.map(e => e.type), ['sandbox_started', 'sandbox_command']);
    assert.match(s.events[1].message, /^Sandbox: exit 0 in 1\.2 s · python3 build\.py · 2 files back to \/work\/$/);
    assert.deepEqual({ runs: s.records.get('job-1').sandbox.runs, seconds: s.records.get('job-1').sandbox.seconds }, { runs: 1, seconds: 1.2 });

    // The next command sends only what changed here, deletes what was deleted here, and a file the command deletes goes from /work/ too.
    s.fake.calls.length = 0;
    fs.writeFileSync(path.join(ws, 'build.py'), 'print("v2")'); fs.rmSync(path.join(ws, 'inbox', 'data.csv'));
    s.fake.runner = ({ box }) => { assert.equal(box.read('inbox/data.csv'), undefined, 'deleted here, deleted there'); box.remove('charts/revenue.png'); return { exitCode: 3, stderr: 'Traceback: boom' }; };
    const second = await s.box.run('job-1', { command: 'python3 build.py', agent: 'ana' });
    const push = s.fake.calls.find(c => c[0] === 'push');
    assert.deepEqual(push.slice(2), [['build.py'], ['inbox/data.csv']], 'only the changed file travels; the deletion is carried');
    assert.match(second, /Exit code 3 in 1\.2 s\./); assert.match(second, /Removed from \/work\/ because the command deleted them: charts\/revenue\.png\./); assert.match(second, /Errors:\nTraceback: boom/);
    assert.equal(fs.existsSync(path.join(ws, 'charts', 'revenue.png')), false);
    assert.equal(s.fake.calls.filter(c => c[0] === 'pull').length, 0, 'nothing changed in the sandbox, nothing is pulled');

    // A file changed here after the sandbox deleted it is kept: only an unchanged copy follows a deletion.
    s.fake.runner = ({ box }) => { box.remove('out/board-deck.pptx'); return { exitCode: 0 }; };
    fs.writeFileSync(path.join(ws, 'out', 'board-deck.pptx'), 'EDITED HERE');
    // The edit travels in first, then the command deletes it in the sandbox; the copy here is the same as the one sent, so it goes.
    await s.box.run('job-1', { command: 'rm out/board-deck.pptx' });
    assert.equal(fs.existsSync(path.join(ws, 'out', 'board-deck.pptx')), false);
  } finally { rm(s.dir); }
});

test('time limits, the missing internet, refusals and an unavailable service are sentences, never exceptions', async () => {
  const s = sandboxes({ run: ({ command, timeoutSeconds }) => command.startsWith('sleep') ? { exitCode: 124, timedOut: true, durationMs: timeoutSeconds * 1000 } : { exitCode: 1, stderr: 'pip._vendor.urllib3: Temporary failure in name resolution' } });
  try {
    assert.match(await s.box.run('job-2', { command: 'sleep 999', minutes: 2 }), /Stopped after 2 minutes: the command ran past its time limit/);
    assert.deepEqual(s.fake.calls.find(c => c[0] === 'exec').slice(2), ['sleep 999', 120], 'the time limit asked for is passed on');
    assert.match(await s.box.run('job-2', { command: 'pip install x' }), /The sandbox has no internet\. For a package it lacks, call sandbox_install/);
    assert.match(await s.box.run('job-2', { command: '' }), /^Refused: Give the command to run/);
    const down = new FakeBroker(); down.ensure = async () => { throw Object.assign(new Error('The sandbox service is not running on this server.'), { status: 503 }); };
    const d = sandboxes({ broker: down });
    try { assert.match(await d.box.run('job-3', { command: 'ls' }), /^The sandbox could not start: The sandbox service is not running on this server\. Carry on without the sandbox/); } finally { rm(d.dir); }
  } finally { rm(s.dir); }
});

test('installs: plain names only, the result named, the event recorded', async () => {
  const s = sandboxes();
  try {
    assert.match(await s.box.install('job-4', { manager: 'pip', packages: ['git+https://x/y'] }), /^Refused: Not a plain package name/);
    assert.equal(s.fake.calls.filter(c => c[0] === 'install').length, 0, 'a refused install never reaches the broker');
    const ok = await s.box.install('job-4', { manager: 'pip', packages: ['python-dateutil==2.8.2'], agent: 'ana' });
    assert.match(ok, /^Installed with pip into this task's sandbox: python-dateutil==2\.8\.2\. The next sandbox_run can use them/);
    assert.ok(s.events.some(e => e.type === 'sandbox_install' && /python-dateutil==2\.8\.2 → installed/.test(e.message)));
    const failing = sandboxes({ broker: new FakeBroker({ install: () => ({ exitCode: 1, output: 'ERROR: No matching distribution found for pkg' }) }) });
    try { assert.match(await failing.box.install('job-5', { manager: 'pip', packages: ['pkg'] }), /The install failed \(exit code 1\)\. pip installs ready-built wheels only/); } finally { rm(failing.dir); }
  } finally { rm(s.dir); }
});

test('a sandbox goes when its task closes, when it idles, and at start for tasks closed meanwhile', async () => {
  let clock = 1_000_000;
  const s = sandboxes(); s.box.now = () => clock;
  try {
    await s.box.run('open-task', { command: 'true' }); await s.box.run('done-task', { command: 'true' }); await s.box.run('idle-task', { command: 'true' });
    clock += 21 * 60000; s.box.tasks.get('open-task').lastUsed = clock - 60000;
    const swept = await s.box.sweep(id => id !== 'done-task');
    assert.deepEqual(swept.sort(), ['done-task', 'idle-task']);
    assert.ok(s.events.some(e => e.id === 'idle-task' && /^Sandbox removed: idle for 20 minutes; the next command starts a fresh one from \/work\/\.$/.test(e.message)));
    assert.ok(s.fake.boxes.has('office/open-task') && !s.fake.boxes.has('office/idle-task') && !s.fake.boxes.has('office/done-task'));
    // Delivered: removed with an event; deleted: removed without one.
    assert.equal(await s.box.destroy('open-task', 'the task was delivered'), true);
    assert.ok(s.events.some(e => e.id === 'open-task' && e.message === 'Sandbox removed: the task was delivered.'));
    await s.box.run('gone-task', { command: 'true' }); const before = s.events.length;
    await s.box.destroy('gone-task', 'the task was deleted', { quiet: true }); assert.equal(s.events.length, before, 'a deleted task gets no event');
    // At start, the broker still has sandboxes of tasks that closed while the office was down (and of another office, left alone).
    await s.fake.ensure('office', 'closed-while-down'); await s.fake.ensure('office', 'still-open'); await s.fake.ensure('other-office', 'theirs');
    assert.deepEqual(await s.box.reap(id => id === 'still-open'), ['closed-while-down']);
    assert.deepEqual([...s.fake.boxes.keys()].sort(), ['office/still-open', 'other-office/theirs']);
  } finally { rm(s.dir); }
});

test('whether sandboxes can run is said in a sentence: not installed, not allowed, switched off, not answering', async () => {
  const off = sandboxes({ settings: { sandbox: false } }), platform = sandboxes({ allowed: false }), sick = sandboxes({ broker: new FakeBroker({ healthy: false, reason: 'The sandbox image localhost/ao-sandbox:latest is not built on this server yet.' }) });
  const absent = sandboxes(); absent.fake.installed = () => false;
  try {
    assert.deepEqual(await absent.box.status(), { available: false, reason: 'The sandbox service is not installed on this server.' });
    assert.deepEqual(await platform.box.status(), { available: false, reason: 'The platform administrator has not allowed sandboxes on this platform.' });
    assert.deepEqual(await off.box.status(), { available: false, reason: 'Sandboxes are switched off in Settings → Office.' });
    const st = await sick.box.status(); assert.equal(st.available, false); assert.match(st.reason, /not built on this server yet/);
    assert.equal(await sandboxes().box.ready(), true);
  } finally { for (const x of [off, platform, sick, absent]) rm(x.dir); }
});

test('writing back refuses anything but a plain file on a plain path', { skip: !canLink && 'this system cannot make symbolic links' }, () => {
  const dir = temp(), outside = temp();
  try {
    fs.writeFileSync(path.join(outside, 'secret.json'), '{"key":"sk-live"}');
    fs.symlinkSync(outside, path.join(dir, 'linked-folder'), 'dir'); fs.symlinkSync(path.join(outside, 'secret.json'), path.join(dir, 'secret.json'));
    fs.mkdirSync(path.join(dir, 'reports'));
    assert.match(writeBack(dir, 'linked-folder/x.txt', 'x').error, /not a plain folder/, 'never writes through a linked folder');
    assert.match(writeBack(dir, 'secret.json', 'overwrite').error, /taken by a link/, 'never writes over a link');
    assert.equal(fs.readFileSync(path.join(outside, 'secret.json'), 'utf8'), '{"key":"sk-live"}');
    assert.match(writeBack(dir, 'reports', 'x').error, /a folder in \/work\/ has that name/);
    assert.match(writeBack(dir, '../escape.txt', 'x').error, /not a plain path/); assert.equal(fs.existsSync(path.join(path.dirname(dir), 'escape.txt')), false);
    assert.match(writeBack(dir, 'node_modules/x.js', 'x').error, /not a plain path/);
    assert.equal(writeBack(dir, 'reports/q3/summary.md', '# Q3').size, 4);
    assert.equal(fs.readFileSync(path.join(dir, 'reports', 'q3', 'summary.md'), 'utf8'), '# Q3');
    assert.deepEqual([...scanWorkspace(dir).keys()], ['reports/q3/summary.md'], 'the scan never follows or sends a link');
    assert.equal(fs.readdirSync(path.join(dir, 'reports', 'q3')).filter(f => f.endsWith('.tmp')).length, 0, 'no temporary file is left behind');
  } finally { rm(dir); rm(outside); }
});

const models = { resolve: () => ({ model: 'x', effort: '' }), instance: async () => null };
test('the tools go to the people granted Sandbox, installs wait for the CEO, and delivery or cancelling removes the sandbox', async () => {
  const dir = temp(), office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents }), built = [], settings = { approvals: true, sandbox: true };
  const fake = new FakeBroker({ run: ({ box }) => { box.write('result.txt', '42'); return { exitCode: 0, stdout: '42' }; } });
  const engine = new OfficeEngine({ dataDir: dir, office, models, knowledgeDir: path.join(dir, 'knowledge'), settings: () => settings, agentFactory: cfg => { built.push(cfg); return { name: cfg.name }; } });
  engine.sandbox = new TaskSandboxes({ client: fake, office: 'office', workspaceDir: id => engine.workspaceDir(id), settings: () => settings, event: (id, ...a) => engine.event(id, ...a), record: (id, fn) => engine.update(id, fn, { touch: false }), exists: id => !!engine.get(id) });
  try {
    const config = office.get(), team = config.teams.find(t => t.id === 'marketing'), specialist = config.agents.find(a => a.department === 'marketing' && a.id !== team.lead);
    specialist.tools = ['sandbox']; office.update(config, new Set());
    const job = engine.create({ dept: 'marketing', text: 'Chart the revenue.', autoStart: false });
    await engine.build(engine.get(job.id), new AbortController().signal);
    const lead = built.find(c => c.name === 'lead-marketing'), granted = lead.subagents.find(s => s.name === specialist.id), other = lead.subagents.find(s => s.name !== specialist.id);
    assert.deepEqual(granted.tools.map(t => t.name).filter(n => n.startsWith('sandbox_')), ['sandbox_run', 'sandbox_install']);
    assert.equal(other.tools.some(t => t.name.startsWith('sandbox_')), false, 'only the person granted it'); assert.equal(lead.tools.some(t => t.name.startsWith('sandbox_')), false);
    assert.deepEqual(granted.interruptOn.sandbox_install, SANDBOX_APPROVALS.sandbox_install); assert.equal(granted.interruptOn.sandbox_run, undefined, 'running code needs no approval');
    assert.match(granted.systemPrompt, /Sandbox: you can run code with sandbox_run/); assert.doesNotMatch(other.systemPrompt, /Sandbox: you can run code/);
    assert.match(lead.systemPrompt, /also has Sandbox \(run code\)/, 'the lead knows who has it');
    // The tool works end to end through the engine's record.
    const answer = await granted.tools.find(t => t.name === 'sandbox_run').invoke({ command: 'python3 -c "print(42)"' });
    assert.match(answer, /Copied back to \/work\/: result\.txt \(2 bytes\)/); assert.equal(fs.readFileSync(path.join(engine.workspaceDir(job.id), 'result.txt'), 'utf8'), '42');
    assert.equal(engine.get(job.id).sandbox.runs, 1); assert.ok(engine.events(job.id).some(e => e.type === 'sandbox_command'));
    // Off in Settings → Office: nobody gets it, and prompts do not mention it.
    settings.sandbox = false; engine.sandbox.health = null; built.length = 0;
    await engine.build(engine.get(job.id), new AbortController().signal);
    const offLead = built.find(c => c.name === 'lead-marketing');
    assert.equal(offLead.subagents.some(s => s.tools.some(t => t.name.startsWith('sandbox_'))), false); assert.doesNotMatch(offLead.subagents.find(s => s.name === specialist.id).systemPrompt, /Sandbox/);
    settings.sandbox = true;
    // Cancelling removes the sandbox, with a line on the timeline.
    engine.cancel(job.id); await new Promise(r => setTimeout(r, 50));
    assert.equal(fake.boxes.size, 0); assert.ok(engine.events(job.id).some(e => e.type === 'sandbox_removed' && e.message === 'Sandbox removed: the task was cancelled.'));
    // Delivered: removed too.
    const second = engine.create({ dept: 'marketing', text: 'Another chart.', autoStart: false });
    await engine.sandbox.run(second.id, { command: 'true' }); assert.equal(fake.boxes.size, 1);
    await engine.finish(second.id, { summary: 'Done.', result: '# Chart' }); await new Promise(r => setTimeout(r, 50));
    assert.equal(fake.boxes.size, 0); assert.ok(engine.events(second.id).some(e => e.message === 'Sandbox removed: the task was delivered.'));
    // Deleted: removed, and no event is written for a task that no longer exists.
    const third = engine.create({ dept: 'marketing', text: 'A third.', autoStart: false }); await engine.sandbox.run(third.id, { command: 'true' }); engine.cancel(third.id); await new Promise(r => setTimeout(r, 50));
    await engine.sandbox.run(third.id, { command: 'true' }).catch(() => {}); engine.remove(third.id); await new Promise(r => setTimeout(r, 50));
    assert.equal(fake.boxes.size, 0); assert.deepEqual(engine.events(third.id), []);
  } finally { await engine.close(); rm(dir); }
});

test('prompts name the sandbox only where it can run, and the quick lane sends code work to the team', () => {
  const dir = temp(), office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  try {
    const config = office.get(), team = { ...config.teams.find(t => t.id === 'marketing'), tools: ['sandbox'] }, lead = config.agents.find(a => a.id === team.lead), agent = config.agents.find(a => a.department === team.id && a.id !== team.lead);
    const specialists = config.agents.filter(a => a.department === team.id && a.id !== team.lead);
    assert.match(specialistPrompt({ office: config, team, agent, leadAgent: lead, sandbox: true }), /Tools you can call: Sandbox \(run code\)\.[\s\S]*Sandbox: you can run code with sandbox_run/);
    assert.doesNotMatch(specialistPrompt({ office: config, team, agent, leadAgent: lead, sandbox: false }), /Sandbox/);
    assert.match(leadPrompt({ office: config, team, lead, specialists, reworkRounds: 3, sandbox: true }), /You can run code with sandbox_run too: use it to verify/);
    assert.match(quickLeadPrompt({ office: config, team, lead, sandbox: true }), /Running code in the sandbox is not quick work: when the task needs it[^.]*, call needs_the_team\./);
    assert.doesNotMatch(quickLeadPrompt({ office: config, team, lead, sandbox: true }), /Tools you can call: Sandbox/);
    const pm = programManagerPrompt({ office: config, teams: [team], sandbox: true });
    assert.match(pm, /Tools: Sandbox \(run code\)/); assert.match(pm, /without it, nobody in the office runs code/);
    assert.doesNotMatch(programManagerPrompt({ office: config, teams: [team], sandbox: false }), /Sandbox/);
  } finally { rm(dir); }
});

test('the tool definitions say what the sandbox holds and that installs wait for approval', () => {
  const [run, install] = sandboxTools({ sandboxes: {}, jobId: 'j', agentId: 'a', commandMinutes: 7 });
  assert.equal(run.name, 'sandbox_run'); assert.match(run.description, /no internet/); assert.match(run.description, /stops after 7 minutes unless you ask for more \(at most 15\)/);
  assert.equal(install.name, 'sandbox_install'); assert.match(install.description, /pauses for the CEO's approval first/);
  assert.deepEqual(sandboxTools({ sandboxes: {}, jobId: 'j', agentId: 'a', install: false }).map(t => t.name), ['sandbox_run']);
});
