// Apply a curation file to the Agency catalogue, then rebuild agency/index.json:
//
//   node scripts/agency-curate.mjs <curation.json> [--dry-run]
//
// The file is a JSON array with one entry per persona to change:
//   { "id": "...", "keep": true, "name": "E2E Test Engineer", "role": "end-to-end test engineer · Playwright",
//     "description": "Sets up Playwright suites ...", "division": "testing", "tags": ["tester", "playwright"], "emoji": "🧪" }
//   { "id": "...", "keep": false, "dropReason": "placeholder template" }
// The name is a job title (unique in the catalogue), the role line is the picker's subtitle, tags are what search ranks by
// (the first one is the person's main role noun), the division is one of DIVISIONS in agency.mjs.
// A persona imported from a skill catalogue (scripts/import-skills.mjs) is written again around its method and gets an id
// from its division and title; a hand-written original keeps its id and body and gets new front matter.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIVISIONS, slugOf } from '../agency.mjs';
import { readFrontMatter, reindex, renderSkillPersona, titleOf } from './import-skills.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), AGENCY = path.join(ROOT, 'agency'), PERSONAS = path.join(AGENCY, 'personas');
const one = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const METHOD = '\n## 📋 The skill, as written\n';

// The pieces of a persona made by import-skills, read back out of its file (null for a hand-written persona).
export function skillParts(markdown) {
  const text = markdown.replace(/\r\n/g, '\n'), at = text.indexOf(METHOD); if (at < 0) return null;
  const { meta } = readFrontMatter(text), end = text.lastIndexOf('\n## 🚨 Critical Rules');
  const experience = /^- \*\*Experience\*\*: The .+? skill from the (.+?) catalogue(?:, (.+))?$/m.exec(text) || [];
  return { source: meta.source || '', title: titleOf((/you carry one skill, "([^"]+)"/.exec(text) || [])[1] || meta.name), catalogue: experience[1] || 'Agentic Awesome Skills', category: experience[2] || '', method: text.slice(at + METHOD.length, end > at ? end : undefined).trim() };
}

// New front matter for a hand-written persona: its other keys (color, vibe, …) and its body stay; the old name in the body follows.
export function withFrontMatter(markdown, { name, description, role, tags = [], emoji }) {
  const text = markdown.replace(/\r\n/g, '\n'), m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text); if (!m) throw new Error('no front matter');
  // A replaced key goes with its folded or indented continuation lines ("description: >" and the lines under it).
  let dropping = false; const keep = m[1].split('\n').filter(l => { if (/^[A-Za-z_-]+:/.test(l)) dropping = /^(name|description|role|tags|emoji):/.test(l); return !dropping; });
  const oldName = readFrontMatter(text).meta.name;
  const head = [`name: ${name}`, `description: ${description}`, role && `role: ${role}`, tags.length && `tags: ${tags.join(', ')}`, `emoji: ${emoji}`, ...keep].filter(Boolean);
  let body = m[2];
  if (oldName && oldName !== name) body = body.split(`**${oldName}**`).join(`**${name}**`).split(`\n# ${oldName} `).join(`\n# ${name} `).replace(new RegExp(`^# ${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?= |$)`, 'm'), `# ${name}`);
  return `---\n${head.join('\n')}\n---\n${body}`;
}

// Everything wrong with a curation file, in sentences; an empty list means it can be applied.
export function problemsOf(entries, index) {
  const known = new Map(index.personas.map(p => [p.id, p])), problems = [], names = new Map(), seen = new Set();
  for (const e of entries) {
    if (!known.has(e.id)) { problems.push(`${e.id}: no such persona`); continue; }
    if (seen.has(e.id)) problems.push(`${e.id}: listed twice`); seen.add(e.id);
    if (e.keep === false) continue;
    if (!DIVISIONS[e.division]) problems.push(`${e.id}: unknown division "${e.division}"`);
    if (!one(e.name, 99) || one(e.name, 99).length > 48) problems.push(`${e.id}: the name must be 1–48 characters`);
    if (/IT Professional/i.test(e.name)) problems.push(`${e.id}: the name still says "IT Professional"`);
    if (one(e.description, 999).length < 30) problems.push(`${e.id}: the description is too short`);
    if (!Array.isArray(e.tags) || !e.tags.length) problems.push(`${e.id}: needs tags`);
    const key = one(e.name, 99).toLowerCase(); names.set(key, [...(names.get(key) || []), e.id]);
  }
  // Names are unique across the catalogue, counting personas this file leaves alone.
  for (const p of index.personas) if (!seen.has(p.id)) { const key = p.name.toLowerCase(); if (names.has(key)) names.set(key, [...names.get(key), p.id]); }
  for (const [name, ids] of names) if (ids.length > 1) problems.push(`"${name}" is used by ${ids.join(', ')}`);
  return problems;
}

export function curate(entries, { dryRun = false } = {}) {
  const index = JSON.parse(fs.readFileSync(path.join(AGENCY, 'index.json'), 'utf8')), problems = problemsOf(entries, index);
  if (problems.length) throw Object.assign(new Error(`${problems.length} problems:\n  ${problems.join('\n  ')}`), { problems });
  const where = new Map(index.personas.map(p => [p.id, p.division])), fileOf = (division, id) => path.join(PERSONAS, division, id + '.md');
  // Read every file first, so a new path never overwrites a persona that has not been read yet.
  const work = entries.map(e => ({ ...e, from: fileOf(where.get(e.id), e.id), text: fs.readFileSync(fileOf(where.get(e.id), e.id), 'utf8') }));
  const ids = new Set(index.personas.filter(p => !work.some(w => w.id === p.id && (w.keep === false || skillParts(w.text)))).map(p => p.id));
  const out = [];
  for (const w of work) {
    if (w.keep === false) { out.push({ from: w.from, drop: true }); continue; }
    const fields = { name: one(w.name, 48), description: one(w.description, 480), role: one(w.role, 120), tags: [...new Set(w.tags.map(t => one(t, 32).toLowerCase()).filter(Boolean))].slice(0, 10), emoji: one(w.emoji, 8) || '🛠️' };
    const parts = skillParts(w.text);
    let id = w.id;
    if (parts) { const base = slugOf(`${w.division}-${fields.name}`); id = base; for (let n = 2; ids.has(id); n++) id = base.slice(0, 45) + '-' + n; ids.add(id); }
    out.push({ from: w.from, to: fileOf(w.division, id), text: parts ? renderSkillPersona({ ...fields, ...parts }) : withFrontMatter(w.text, fields) });
  }
  const summary = { kept: out.filter(o => !o.drop).length, dropped: out.filter(o => o.drop).length, moved: out.filter(o => !o.drop && o.from !== o.to).length };
  if (dryRun) return summary;
  for (const o of out) fs.rmSync(o.from, { force: true });
  for (const o of out.filter(o => !o.drop)) { fs.mkdirSync(path.dirname(o.to), { recursive: true }); fs.writeFileSync(o.to, o.text); }
  for (const d of fs.readdirSync(PERSONAS)) if (!fs.readdirSync(path.join(PERSONAS, d)).length) fs.rmdirSync(path.join(PERSONAS, d));
  return { ...summary, ...reindex() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (!file || !fs.existsSync(file)) { console.error('usage: node scripts/agency-curate.mjs <curation.json> [--dry-run]'); process.exit(2); }
  try { const r = curate(JSON.parse(fs.readFileSync(file, 'utf8')), { dryRun: process.argv.includes('--dry-run') }); console.log(JSON.stringify(r)); }
  catch (error) { console.error(error.message); process.exit(1); }
}
