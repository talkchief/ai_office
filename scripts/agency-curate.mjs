// Apply a curation file to the Agency catalogue, then rebuild agency/index.json:
//
//   node scripts/agency-curate.mjs <curation.json> [--dry-run]
//   node scripts/agency-curate.mjs --refresh <skills folder> [--min 1500] [--dry-run]   → methods again from the source skills
//   node scripts/agency-curate.mjs --missions <missions.json> [--dry-run]              → each persona's own mission and rules
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
import { cutAtHeading, inlineReferences, readFrontMatter, reindex, renderSkillPersona, stripStock, titleOf } from './import-skills.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), AGENCY = path.join(ROOT, 'agency'), PERSONAS = path.join(AGENCY, 'personas');
const one = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const METHOD = '\n## 📋 The skill, as written\n';

// The pieces of a persona made by import-skills, read back out of its file (null for a hand-written persona).
export function skillParts(markdown) {
  const text = markdown.replace(/\r\n/g, '\n'), at = text.indexOf(METHOD); if (at < 0) return null;
  const { meta } = readFrontMatter(text), end = text.lastIndexOf('\n## 🚨 Critical Rules');
  const experience = /^- \*\*Experience\*\*: The .+? skill from the (.+?) catalogue(?:, (.+))?$/m.exec(text) || [];
  // The persona's own mission and rules, without the office's operating lines the template always adds.
  const section = heading => { const i = text.indexOf(`\n## ${heading}\n`); if (i < 0) return []; const rest = text.slice(i + heading.length + 5), stop = rest.indexOf('\n## ');
    return (stop < 0 ? rest : rest.slice(0, stop)).split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim()).filter(b => !OFFICE_LINE.test(b)); };
  return { source: meta.source || '', title: titleOf((/you carry one skill, "([^"]+)"/.exec(text) || [])[1] || meta.name), catalogue: experience[1] || 'Agentic Awesome Skills', category: experience[2] || '', method: text.slice(at + METHOD.length, end > at ? end : undefined).trim(), mission: section('🎯 Core Mission'), rules: section('🚨 Critical Rules') };
}
const OFFICE_LINE = /^(Apply the .+ skill to the assignment|Hand finished work to the lead|Stop and report when the skill needs|Cite the skill by name|Follow the skill's own rules|Never invent numbers or facts|Deliverables go to \/work\/|Say which step of the skill produced)/;

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

// How much real method a persona carries: its method without pointers into references/ or resources/ and the catalogue's stock headings.
const POINTS_AWAY = /(?:references|resources)\/[A-Za-z0-9_.\/-]+\.md/;
export const substanceOf = method => method.split('\n').filter(l => !POINTS_AWAY.test(l) && !/^## (Detailed Guide|When to Use|Do Not Use|Limitations)/i.test(l)).join('\n').trim().length;

// The persona written again around new parts; its front matter (title, description, role, tags, emoji) stays.
const rerender = (text, parts) => { const { meta } = readFrontMatter(text);
  return renderSkillPersona({ ...parts, name: meta.name, description: meta.description, role: meta.role || '', tags: String(meta.tags || '').split(',').map(t => t.trim()).filter(Boolean), emoji: meta.emoji || '🛠️' }); };

// Specific standing instructions for imported personas (node scripts/agency-curate.mjs --missions <file.json>): a JSON array of
// { id, mission: [3–6 bullets], rules: [0–3 bullets] } written from each persona's method. Everything else stays.
export function applyMissions(entries, { dryRun = false } = {}) {
  const index = JSON.parse(fs.readFileSync(path.join(AGENCY, 'index.json'), 'utf8')), where = new Map(index.personas.map(p => [p.id, p.division])), skipped = [];
  let applied = 0;
  for (const e of entries) {
    const mission = (e.mission || []).map(b => one(b, 200)).filter(b => b.length >= 20).slice(0, 6), rules = (e.rules || []).map(b => one(b, 200)).filter(b => b.length >= 15).slice(0, 3);
    const file = where.has(e.id) && path.join(PERSONAS, where.get(e.id), e.id + '.md'), text = file && fs.readFileSync(file, 'utf8'), parts = text && skillParts(text);
    if (!parts || mission.length < 3) { skipped.push(e.id); continue; }
    if (!dryRun) fs.writeFileSync(file, rerender(text, { ...parts, mission, rules }));
    applied++;
  }
  return { applied, skipped: skipped.length, skippedIds: skipped.slice(0, 20), ...(dryRun ? {} : reindex()) };
}

// Imported personas whose method points into the skill's references/ or resources/ folder get their method again from the source skill
// (node scripts/agency-curate.mjs --refresh <skills folder>), with the references inlined; the title, role, tags and
// description stay. Any imported persona that still carries less than `min` characters of method is removed.
export function refreshMethods(skillsDir, { min = 1500, max = 7000, dryRun = false } = {}) {
  const index = JSON.parse(fs.readFileSync(path.join(AGENCY, 'index.json'), 'utf8')), writes = [], dropped = [];
  let refreshed = 0;
  for (const p of index.personas) {
    const file = path.join(PERSONAS, p.division, p.id + '.md'), text = fs.readFileSync(file, 'utf8'), parts = skillParts(text); if (!parts) continue;
    let method = parts.method; const dir = path.join(skillsDir, parts.source.split(' · ').pop());
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) { // from the source: references inlined, stock lines out, cut at the budget
      method = cutAtHeading(stripStock(inlineReferences(readFrontMatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')).body.replace(/^#\s+.+\n/, '').trim(), dir)), max); refreshed++;
    } else method = stripStock(inlineReferences(method, dir)); // a skill from another catalogue keeps its method, less stock lines and dead pointers
    if (substanceOf(method) < min) { dropped.push(`${p.id} (${p.name})`); writes.push({ file }); continue; }
    if (method === parts.method) continue;
    writes.push({ file, text: rerender(text, { ...parts, method }) });
  }
  const summary = { refreshed, rewritten: writes.filter(w => w.text).length, dropped: dropped.length };
  if (dryRun) return { ...summary, droppedList: dropped };
  for (const w of writes) w.text ? fs.writeFileSync(w.file, w.text) : fs.rmSync(w.file, { force: true });
  return { ...summary, ...reindex() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--missions')) {
  const argv = process.argv.slice(2), file = argv[argv.indexOf('--missions') + 1];
  if (!file || !fs.existsSync(file)) { console.error('usage: node scripts/agency-curate.mjs --missions <missions.json> [--dry-run]'); process.exit(2); }
  console.log(JSON.stringify(applyMissions(JSON.parse(fs.readFileSync(file, 'utf8')), { dryRun: argv.includes('--dry-run') }), null, 1)); process.exit(0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--refresh')) {
  const argv = process.argv.slice(2), dir = argv[argv.indexOf('--refresh') + 1], min = Number(argv[argv.indexOf('--min') + 1]) || 1500;
  if (!dir || !fs.existsSync(dir)) { console.error('usage: node scripts/agency-curate.mjs --refresh <skills folder> [--min 1500] [--dry-run]'); process.exit(2); }
  const r = refreshMethods(dir, { min: argv.includes('--min') ? min : 1500, dryRun: argv.includes('--dry-run') });
  console.log(JSON.stringify(r, null, 1)); process.exit(0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (!file || !fs.existsSync(file)) { console.error('usage: node scripts/agency-curate.mjs <curation.json> [--dry-run]'); process.exit(2); }
  try { const r = curate(JSON.parse(fs.readFileSync(file, 'utf8')), { dryRun: process.argv.includes('--dry-run') }); console.log(JSON.stringify(r)); }
  catch (error) { console.error(error.message); process.exit(1); }
}
