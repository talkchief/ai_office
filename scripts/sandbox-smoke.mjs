// The sandbox on this server, end to end through the real broker: a python-pptx deck with a chart, pytest, node --test, the missing
// internet, link and pipe escapes, a fork bomb, a memory balloon, a time limit, pip and npm installs, the locked-down container, and
// removal. Runs on a throwaway workspace; nothing touches an office.
//
//   node scripts/sandbox-smoke.mjs            (as root, or as a member of the ao-sandbox group)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrokerClient, TaskSandboxes } from '../engine/sandbox.mjs';

const client = new BrokerClient(), office = 'smoke', task = `smoke-${Date.now()}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-sandbox-smoke-')), ws = path.join(dir, task), events = [];
fs.mkdirSync(ws, { recursive: true });
const box = new TaskSandboxes({ client, office, workspaceDir: () => ws, settings: () => ({ sandbox: true, sandboxCommandMinutes: 5, sandboxIdleMinutes: 20 }), event: (id, type, agent, message) => events.push(`${type}: ${message}`) });
let failed = 0;
const step = async (name, fn) => { const t = Date.now(); try { const note = await fn(); console.log(`✓ ${name}${note ? ' — ' + note : ''} (${((Date.now() - t) / 1000).toFixed(1)} s)`); } catch (error) { failed++; console.log(`✗ ${name} — ${error.message}`); } };
const expect = (ok, message) => { if (!ok) throw new Error(message); };
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true }); fs.writeFileSync(path.join(ws, rel), text); };

await step('the broker answers and the image is built', async () => { const h = await client.health(); expect(h.ok, h.reason || 'not ok'); return `podman ${h.podman} · ${h.image} · ${h.sandboxes} running`; });

await step('python-pptx and matplotlib make a deck with a chart from an attached CSV', async () => {
  write('inbox/revenue.csv', 'month,revenue\nJan,120\nFeb,135\nMar,160\nApr,172\n');
  write('build_deck.py', `import pandas as pd, matplotlib.pyplot as plt
from pptx import Presentation
from pptx.util import Inches
df = pd.read_csv('inbox/revenue.csv')
plt.figure(figsize=(6, 3)); plt.plot(df.month, df.revenue, marker='o'); plt.title('Revenue'); plt.tight_layout(); plt.savefig('charts/revenue.png', dpi=120)
deck = Presentation(); slide = deck.slides.add_slide(deck.slide_layouts[5]); slide.shapes.title.text = 'Revenue, Q1'
slide.shapes.add_picture('charts/revenue.png', Inches(1), Inches(1.6), width=Inches(8))
deck.save('out/board-deck.pptx'); print('slides:', len(deck.slides), 'growth:', round(df.revenue.iloc[-1] / df.revenue.iloc[0] - 1, 3))
`);
  const answer = await box.run(task, { command: 'mkdir -p charts out && python3 build_deck.py' });
  expect(/Exit code 0/.test(answer), answer.slice(0, 600));
  const deck = path.join(ws, 'out', 'board-deck.pptx'); expect(fs.existsSync(deck) && fs.statSync(deck).size > 20000, 'the deck did not come back: ' + answer.slice(0, 600));
  expect(fs.readFileSync(deck).subarray(0, 2).toString() === 'PK', 'the deck is not a zip file');
  return `${Math.round(fs.statSync(deck).size / 1024)} KB deck and ${Math.round(fs.statSync(path.join(ws, 'charts', 'revenue.png')).size / 1024)} KB chart back in /work/ · ${answer.match(/growth: [\d.]+/)?.[0]}`;
});

await step('pytest runs a test suite', async () => {
  write('calc/calc.py', 'def margin(revenue, cost):\n    return round((revenue - cost) / revenue, 4)\n');
  write('calc/test_calc.py', 'from calc import margin\n\ndef test_margin():\n    assert margin(200, 150) == 0.25\n');
  const answer = await box.run(task, { command: 'cd calc && python3 -m pytest -q' });
  expect(/Exit code 0/.test(answer) && /1 passed/.test(answer), answer.slice(0, 800)); return '1 passed';
});

await step('node --test runs a JavaScript suite', async () => {
  write('app/sum.test.mjs', "import test from 'node:test'; import assert from 'node:assert/strict';\ntest('adds', () => assert.equal(1 + 2, 3));\n");
  const answer = await box.run(task, { command: 'node --test app/sum.test.mjs' });
  expect(/Exit code 0/.test(answer) && /pass 1/.test(answer), answer.slice(0, 800)); return 'pass 1';
});

await step('the sandbox has no internet, and the answer says what to do instead', async () => {
  const answer = await box.run(task, { command: `python3 -c "import urllib.request; urllib.request.urlopen('https://pypi.org', timeout=5)"` });
  expect(!/Exit code 0/.test(answer) && /The sandbox has no internet/.test(answer), answer.slice(0, 800)); return 'connection refused, hint given';
});

await step('links, pipes and root-owned paths never reach the workspace', async () => {
  const answer = await box.run(task, { command: 'ln -s /etc/passwd leak.txt; ln -s / rootfs; mkfifo pipe; echo ok' });
  expect(/Not copied back: /.test(answer) && /leak\.txt \(a link\)/.test(answer) && /pipe \(a pipe\)/.test(answer), answer.slice(0, 800));
  for (const name of ['leak.txt', 'rootfs', 'pipe']) { let st = null; try { st = fs.lstatSync(path.join(ws, name)); } catch {} expect(!st, `${name} reached the workspace`); }
  return 'leak.txt, rootfs and pipe refused';
});

await step('the container is locked down: user 1000, no capabilities, read-only root, no host files', async () => {
  const answer = await box.run(task, { command: 'id -u; grep CapEff /proc/self/status; touch /usr/x 2>&1 || true; ls /var/lib/ao-sandbox 2>&1 || true; cat /opt/agents-office/data/providers.json 2>&1 || true' });
  expect(/Output:\n1000\n/.test(answer), 'not user 1000: ' + answer.slice(0, 400));
  expect(/CapEff:\s*0000000000000000/.test(answer), 'capabilities are not empty: ' + answer.slice(0, 600));
  expect(/Read-only file system/.test(answer), 'the root is writable: ' + answer.slice(0, 600));
  expect(!/apiKey/.test(answer) && /No such file or directory/.test(answer), 'host files are visible: ' + answer.slice(0, 600));
  return 'uid 1000 · CapEff 0 · read-only root · no host paths';
});

await step('a fork bomb is contained and the sandbox keeps working', async () => {
  const answer = await box.run(task, { command: 'bash -c ":(){ :|:& };:" ; sleep 3; echo survived', minutes: 1 });
  expect(/running in the background; they were stopped when the command ended/.test(answer), 'the left-over processes were not stopped: ' + answer.slice(0, 600));
  const after = await box.run(task, { command: 'echo alive && ps -e --no-headers | wc -l' });
  expect(/alive\n[2-7]\b/.test(after), 'the sandbox did not recover: ' + after.slice(0, 400));
  return `${answer.match(/It left (\d+) process/)?.[1]} processes stopped; the next command runs`;
});

await step('a memory balloon is killed at the limit', async () => {
  const answer = await box.run(task, { command: `python3 -c "b = bytearray(3 * 1024**3); print('allocated')"` });
  expect(!/allocated/.test(answer.split('Output')[1] || '') && !/Exit code 0/.test(answer), answer.slice(0, 600));
  return answer.split('\n')[1];
});

await step('a command past its time limit is stopped', async () => {
  const answer = await box.run(task, { command: 'sleep 100', minutes: 1 });
  expect(/Stopped after 1 minute/.test(answer), answer.slice(0, 400)); return 'stopped at 1 minute';
});

await step('pip installs a wheel into /deps, and the offline sandbox imports it', async () => {
  const installed = await box.install(task, { manager: 'pip', packages: ['python-dateutil==2.8.2'] });
  expect(/^Installed with pip/.test(installed), installed.slice(0, 800));
  const answer = await box.run(task, { command: `python3 -c "import dateutil; print(dateutil.__version__)"` });
  expect(/2\.8\.2/.test(answer), answer.slice(0, 600)); return 'dateutil 2.8.2 imported';
});

await step('npm installs without scripts into /deps, and node requires it', async () => {
  const installed = await box.install(task, { manager: 'npm', packages: ['left-pad@1.3.0'] });
  expect(/^Installed with npm/.test(installed), installed.slice(0, 800));
  const answer = await box.run(task, { command: `node -e "console.log(require('left-pad')('7', 3, '0'))"` });
  expect(/007/.test(answer), answer.slice(0, 600)); return 'left-pad required';
});

await step('a package that needs a source build is refused, not built', async () => {
  const answer = await box.install(task, { manager: 'pip', packages: ['pycrypto==2.6.1'] });
  expect(/^The install failed/.test(answer) && /wheels only/.test(answer), answer.slice(0, 600)); return 'refused';
});

await step('the sandbox is removed, with its volumes', async () => {
  expect(await box.destroy(task, 'the smoke test finished'), 'nothing was removed');
  const left = (await client.sandboxes()).filter(s => s.office === office && s.task === task);
  expect(!left.length, 'the container is still listed'); return 'gone';
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${failed ? `✗ ${failed} step${failed === 1 ? '' : 's'} failed` : '✓ every step passed'} · ${events.length} events: ${events.map(e => e.split(':')[0]).join(', ')}`);
process.exit(failed ? 1 : 0);
