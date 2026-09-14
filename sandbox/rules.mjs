// What a sandbox may be asked to do, shared by the office and the broker so both refuse the same things. No I/O here.
//
// A sandbox belongs to one task of one office. It runs one fixed container profile: no network, every capability dropped, a
// read-only root, a non-root user, memory, process and CPU caps, and two volumes of its own (/work and /deps). Nothing a caller
// sends can change the image, a mount, the user, the network or a privilege: those are not parameters anywhere below.

export const SANDBOX_TOOL = 'sandbox';
export const SANDBOX_LABEL = 'Sandbox (run code)';
export const DEFAULT_SOCKET = '/run/ao-sandbox/broker.sock';
export const DEFAULT_IMAGE = 'localhost/ao-sandbox:latest';

// Directories a command may fill that never travel back to the task's workspace: caches, dependencies and version control.
export const SKIP_DIRS = ['node_modules', '__pycache__', '.git', '.pytest_cache', '.mypy_cache', '.venv', '.cache', '.npm'];

export const LIMITS = {
  commandMinutesDefault: 5, commandMinutesMax: 15,
  installSeconds: 300,
  fileBytes: 50 * 1024 * 1024,        // one file, either way
  copyBytes: 200 * 1024 * 1024,       // one copy in or out
  copyFiles: 2000,                    // files back per command
  outputChars: 20000,                 // the tail of stdout and of stderr each
  workBytes: 2 * 1024 * 1024 * 1024,  // /work inside one sandbox
  commandChars: 8000,
  packages: 40,
};

const OFFICE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TASK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const validOffice = id => typeof id === 'string' && OFFICE_ID.test(id);
export const validTask = id => typeof id === 'string' && TASK_ID.test(id);
export const containerName = (office, task) => `ao-${office}-${task}`;
export const volumeName = (office, task, which) => `ao-${office}-${task}-${which}`;

// A relative path inside /work: no absolute path, no "..", no empty or dot segment, no NUL, forward slashes, at most 400 characters.
export function safeRelative(p) {
  if (typeof p !== 'string' || !p || p.length > 400 || p.includes('\0') || p.includes('\\')) return null;
  if (p.startsWith('/')) return null;
  const parts = p.split('/');
  if (parts.some(s => !s || s === '.' || s === '..')) return null;
  return parts.join('/');
}
export const inSkippedDir = p => p.split('/').slice(0, -1).some(s => SKIP_DIRS.includes(s));

// A command line: text, one command per call (it may chain with && or ;), under the size cap.
export function validCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return 'Give the command to run, for example: python3 /work/build_deck.py';
  if (command.length > LIMITS.commandChars) return `Keep a command under ${LIMITS.commandChars.toLocaleString('en')} characters: write a script to a file under /work/ and run the file.`;
  if (command.includes('\0')) return 'The command contains a NUL character.';
  return '';
}
export const commandSeconds = minutes => Math.round(60 * Math.min(LIMITS.commandMinutesMax, Math.max(1, Number(minutes) || LIMITS.commandMinutesDefault)));

// Packages come from the public registries by name and version only: never a URL, a path, a VCS reference, an option or a file.
const PIP = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(\[[A-Za-z0-9._,-]{1,100}\])?((==|>=|<=|~=|!=|>|<)[A-Za-z0-9.*+!_-]{1,40}(,(==|>=|<=|~=|!=|>|<)[A-Za-z0-9.*+!_-]{1,40}){0,3})?$/;
const NPM = /^(@[a-z0-9][a-z0-9._~-]{0,50}\/)?[a-z0-9][a-z0-9._~-]{0,100}(@[A-Za-z0-9.^~<>=*|_ -]{1,40})?$/;
export function validPackages(manager, packages) {
  if (!['pip', 'npm'].includes(manager)) return { error: 'Choose pip (Python) or npm (Node) as the manager.' };
  if (!Array.isArray(packages) || !packages.length) return { error: 'Name the packages to install, for example ["python-dateutil==2.8.2"].' };
  if (packages.length > LIMITS.packages) return { error: `Install at most ${LIMITS.packages} packages at a time.` };
  const list = packages.map(p => String(p ?? '').trim());
  const bad = list.filter(p => !(manager === 'pip' ? PIP : NPM).test(p) || /(:\/\/|^git\+|^file:|^\.|\/\/)/i.test(p) || (manager === 'npm' && / /.test(p.replace(/@[^@]*$/, ''))));
  if (bad.length) return { error: `Not a plain package name${manager === 'pip' ? ' with an optional version (name, name==1.2.3, name>=2)' : ' with an optional version (name, @scope/name, name@1.2.3)'}: ${bad.slice(0, 5).join(', ')}. URLs, paths, git references and options are never installed.` };
  return { packages: [...new Set(list)] };
}

// The container that runs a task's commands. `image`, the limits and the paths come from the broker's own configuration.
export function runArgs({ office, task, image = DEFAULT_IMAGE, memory = '1g', cpus = '1', pids = 256, init = true, now = Date.now() }) {
  const name = containerName(office, task);
  return ['run', '-d', '--name', name, '--hostname', 'sandbox',
    '--label', 'ao.sandbox=1', '--label', `ao.office=${office}`, '--label', `ao.task=${task}`, '--label', `ao.created=${now}`,
    '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m',
    '--mount', `type=volume,src=${volumeName(office, task, 'work')},dst=/work,U=true`,
    '--mount', `type=volume,src=${volumeName(office, task, 'deps')},dst=/deps,ro=true`,
    '--user', '1000:1000', '--memory', memory, '--memory-swap', memory, '--pids-limit', String(pids), '--cpus', String(cpus),
    ...(init ? ['--init'] : []),
    '--env', 'HOME=/tmp', '--env', 'PYTHONPATH=/deps/python', '--env', 'NODE_PATH=/deps/node/node_modules', '--env', 'MPLBACKEND=Agg',
    '--env', 'PYTHONDONTWRITEBYTECODE=1', '--env', 'PATH=/deps/node/node_modules/.bin:/deps/python/bin:/usr/local/bin:/usr/bin:/bin',
    '--workdir', '/work', image, 'sleep', 'infinity'];
}
// One command in a running sandbox, killed by `timeout` inside the container when it runs past its time.
export const execArgs = ({ office, task, command, seconds, stdin = false }) =>
  ['exec', ...(stdin ? ['-i'] : []), '--user', '1000:1000', '--workdir', '/work', containerName(office, task), 'timeout', '-k', '5', String(seconds), 'bash', '-c', command];
// A helper script run by the broker inside the sandbox (listing, copying): no time wrapper, its own interpreter.
export const scriptArgs = ({ office, task, script, stdin = false }) => ['exec', ...(stdin ? ['-i'] : []), '--user', '1000:1000', '--workdir', '/work', containerName(office, task), 'python3', '-c', script];
// The install helper: the network (package registries), never the task's files, no install scripts, then gone.
export function installArgs({ office, task, manager, packages, image = DEFAULT_IMAGE, seconds = LIMITS.installSeconds }) {
  const install = manager === 'pip'
    ? ['pip', 'install', '--no-cache-dir', '--disable-pip-version-check', '--upgrade', '--only-binary=:all:', '--index-url', 'https://pypi.org/simple', '--target', '/deps/python', ...packages]
    : ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-update-notifier', '--registry=https://registry.npmjs.org', '--prefix', '/deps/node', ...packages];
  return ['run', '--rm', '--name', `${containerName(office, task)}-install`, '--label', 'ao.sandbox-helper=1', '--label', `ao.office=${office}`, '--label', `ao.task=${task}`,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m',
    '--mount', `type=volume,src=${volumeName(office, task, 'deps')},dst=/deps,U=true`,
    '--user', '1000:1000', '--memory', '1g', '--memory-swap', '1g', '--pids-limit', '256', '--cpus', '1', '--env', 'HOME=/tmp',
    image, 'timeout', '-k', '5', String(seconds), ...install];
}

// Scripts the broker runs inside a sandbox (Python is in the image). They never follow a link and never open anything but a
// regular file; paths are checked again here, whatever the caller already checked.
const PY_COMMON = `
import os, sys, json, stat, base64
ROOT = '/work'
SKIP = set(${JSON.stringify(SKIP_DIRS)})
def safe(p):
    if not isinstance(p, str) or not p or len(p) > 400 or '\\0' in p or '\\\\' in p or p.startswith('/'): return None
    parts = p.split('/')
    if any(s in ('', '.', '..') for s in parts): return None
    return '/'.join(parts)
def kind(mode):
    if stat.S_ISLNK(mode): return 'link'
    if stat.S_ISFIFO(mode): return 'fifo'
    if stat.S_ISSOCK(mode): return 'socket'
    if stat.S_ISCHR(mode) or stat.S_ISBLK(mode): return 'device'
    if stat.S_ISDIR(mode): return 'folder'
    return 'other'
def parents_plain(p, create=False):
    cur = ROOT
    for part in p.split('/')[:-1]:
        cur = os.path.join(cur, part)
        try:
            st = os.lstat(cur)
        except FileNotFoundError:
            if not create: return False
            os.mkdir(cur, 0o755); continue
        if not stat.S_ISDIR(st.st_mode): return False
    return True
`;
export const LIST_SCRIPT = `${PY_COMMON}
files, skipped, truncated, total = [], [], False, 0
for dirpath, dirnames, filenames in os.walk(ROOT, followlinks=False):
    rel = os.path.relpath(dirpath, ROOT)
    keep = []
    for d in dirnames:
        rp = d if rel == '.' else rel + '/' + d
        st = os.lstat(os.path.join(dirpath, d))
        if stat.S_ISLNK(st.st_mode): skipped.append({'p': rp, 't': 'link'}); continue
        if d in SKIP: continue
        keep.append(d)
    dirnames[:] = keep
    for f in filenames:
        rp = f if rel == '.' else rel + '/' + f
        try: rp.encode('utf-8')
        except UnicodeEncodeError: skipped.append({'p': rp.encode('utf-8', 'replace').decode(), 't': 'name'}); continue
        st = os.lstat(os.path.join(dirpath, f))
        if stat.S_ISREG(st.st_mode):
            files.append({'p': rp, 's': st.st_size, 'm': st.st_mtime_ns}); total += st.st_size
        else: skipped.append({'p': rp, 't': kind(st.st_mode)})
        if len(files) >= 20000: truncated = True; break
    if truncated: break
print(json.dumps({'files': files, 'skipped': skipped[:200], 'truncated': truncated, 'bytes': total}))
`;
export const PULL_SCRIPT = `${PY_COMMON}
req = json.load(sys.stdin)
MAXFILE, MAXTOTAL, total = int(req.get('maxFile', 0)), int(req.get('maxTotal', 0)), 0
out = sys.stdout
for raw in req.get('paths', [])[:${LIMITS.copyFiles}]:
    p = safe(raw)
    if p is None: out.write(json.dumps({'path': str(raw)[:400], 'skipped': 'not a plain path inside /work'}) + '\\n'); continue
    full = os.path.join(ROOT, p)
    try:
        st = os.lstat(full)
    except FileNotFoundError:
        out.write(json.dumps({'path': p, 'skipped': 'gone'}) + '\\n'); continue
    if not stat.S_ISREG(st.st_mode) or not parents_plain(p): out.write(json.dumps({'path': p, 'skipped': 'a ' + kind(st.st_mode) + ', not a plain file'}) + '\\n'); continue
    if st.st_size > MAXFILE: out.write(json.dumps({'path': p, 'skipped': 'over the size a file may have', 'size': st.st_size}) + '\\n'); continue
    if total + st.st_size > MAXTOTAL: out.write(json.dumps({'path': p, 'skipped': 'the copy reached its size limit', 'size': st.st_size}) + '\\n'); continue
    fd = os.open(full, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode): out.write(json.dumps({'path': p, 'skipped': 'not a plain file'}) + '\\n'); continue
        chunks = []
        while True:
            b = os.read(fd, 1048576)
            if not b: break
            chunks.append(b)
        data = b''.join(chunks); total += len(data)
        out.write(json.dumps({'path': p, 'size': len(data), 'mtime': os.fstat(fd).st_mtime_ns, 'data': base64.b64encode(data).decode('ascii')}) + '\\n')
    finally: os.close(fd)
out.flush()
`;
export const PUSH_SCRIPT = `${PY_COMMON}
written, deleted, skipped = [], [], []
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    e = json.loads(line); p = safe(e.get('path'))
    if p is None: skipped.append({'p': str(e.get('path'))[:400], 'why': 'not a plain path inside /work'}); continue
    full = os.path.join(ROOT, p)
    if e.get('op') == 'del':
        try:
            st = os.lstat(full)
            if not stat.S_ISDIR(st.st_mode) and parents_plain(p): os.unlink(full); deleted.append(p)
        except FileNotFoundError: pass
        continue
    if not parents_plain(p, create=True): skipped.append({'p': p, 'why': 'a folder on its path is not a plain folder'}); continue
    try:
        st = os.lstat(full)
        if stat.S_ISDIR(st.st_mode): skipped.append({'p': p, 'why': 'a folder has that name'}); continue
        os.unlink(full)
    except FileNotFoundError: pass
    fd = os.open(full, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, 'wb') as fh: fh.write(base64.b64decode(e.get('data', '')))
    st = os.lstat(full)
    written.append({'p': p, 's': st.st_size, 'm': st.st_mtime_ns})
print(json.dumps({'written': written, 'deleted': deleted, 'skipped': skipped}))
`;
