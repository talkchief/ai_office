// Turn a folder of Agent Skills (one SKILL.md per subfolder) into Agency personas the CEO can hire, then rebuild the Agency index.
//
//   node scripts/import-skills.mjs <skills folder> [--division it-professional] [--label "IT Professional"] [--prefix "IT Professional "]
//                                  [--max 7000] [--skip-risk offensive] [--source "<url> (MIT)"]
//   node scripts/import-skills.mjs --reindex        → rebuild agency/index.json from the persona files on disk, nothing else
//
// Each persona is named "<prefix><skill title>", carries the skill's own text as its method (cut at a heading past --max characters),
// and lands in agency/personas/<division>/. Hiring one gives a team that person plus the skill, as with every other persona.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePersona, slugOf } from '../agency.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), AGENCY = path.join(ROOT, 'agency');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback; };

export function readFrontMatter(markdown) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown); if (!fm) return { meta: {}, body: markdown.trim() };
  const meta = {}; for (const line of fm[1].split(/\r?\n/)) { const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(line); if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); }
  return { meta, body: fm[2].trim() };
}
export const titleOf = name => String(name || '').replace(/^\d+[-_]/, '').replace(/[-_]+/g, ' ').trim().split(/\s+/).map(w => w.length > 2 || /^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()).join(' ');
const cutAtHeading = (text, max) => { if (text.length <= max) return text; const cut = text.lastIndexOf('\n## ', max); return text.slice(0, cut > max / 2 ? cut : max).trimEnd() + '\n\n(Shortened: the skill continues in its source.)'; };
const oneLine = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

// One persona per skill: the office's persona shape (identity, mission, method, rules) around the skill's own text.
export function personaFromSkill(markdown, { id, prefix = 'IT Professional ', max = 7000, source = '' } = {}) {
  const { meta, body } = readFrontMatter(markdown);
  const skillId = meta.id || meta.name || id, title = titleOf(meta.name && !/^\d/.test(meta.name) ? meta.name : skillId), name = `${prefix}${title}`;
  const description = oneLine(meta.description, 480) || `Applies the ${title} skill.`;
  const risk = String(meta.risk || 'safe').toLowerCase(), category = oneLine(meta.category, 40);
  const method = cutAtHeading(body.replace(/^#\s+.+\n/, '').trim(), max);
  const text = `---
name: ${name}
description: ${description.replace(/[\r\n]+/g, ' ')}
color: slate
emoji: 🛠️
vibe: Applies the ${title} skill exactly as written, step by step, and says which step produced what.
source: ${source ? source + ' · ' : ''}${skillId}
---

# ${name} Agent

You are **${name}**: you carry one skill, "${title}", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: ${title} specialist${category ? ' (' + category + ')' : ''}
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The ${title} skill from the Agentic Awesome Skills catalogue${category ? ', ' + category : ''}

## 🎯 Core Mission
- Apply the ${title} skill to the assignment, step by step, without skipping a step
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute
- Cite the skill by name in the report so the lead knows which method was applied

## 📋 The skill, as written
${method}

## 🚨 Critical Rules
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
`;
  return { id: slugOf(slugOf(`it-pro-${skillId}`)), name, title, description, risk, category, text };
}

// Rebuild agency/index.json from the persona files on disk, keeping known division labels and adding new ones.
export function reindex({ labels = {} } = {}) {
  const file = path.join(AGENCY, 'index.json'), old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { divisions: {}, personas: [] };
  const divisions = { ...(old.divisions || {}), ...labels }, personas = [];
  for (const division of fs.readdirSync(path.join(AGENCY, 'personas')).filter(d => fs.statSync(path.join(AGENCY, 'personas', d)).isDirectory()).sort()) {
    if (!divisions[division]) divisions[division] = titleOf(division);
    for (const entry of fs.readdirSync(path.join(AGENCY, 'personas', division)).filter(f => f.endsWith('.md')).sort()) {
      const full = path.join(AGENCY, 'personas', division, entry), persona = parsePersona(fs.readFileSync(full, 'utf8'), { division, file: entry });
      if (!persona) { console.warn('skipped (no front matter):', division + '/' + entry); continue; }
      personas.push({ id: persona.id, division, label: divisions[division], name: persona.name, description: persona.description, emoji: persona.emoji, role: persona.role, bytes: fs.statSync(full).size });
    }
  }
  fs.writeFileSync(file, JSON.stringify({ source: old.source || 'https://github.com/msitarzewski/agency-agents', license: old.license || 'MIT', syncedAt: new Date().toISOString(), divisions, personas }, null, 1));
  return { personas: personas.length, divisions: Object.keys(divisions).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (args.includes('--reindex')) { const r = reindex(); console.log(`agency: ${r.personas} personas in ${r.divisions} divisions → agency/index.json`); process.exit(0); }
  const source = args.find(a => !a.startsWith('--') && (args.indexOf(a) === 0 || !args[args.indexOf(a) - 1].startsWith('--')));
  if (!source || !fs.existsSync(source)) { console.error('usage: node scripts/import-skills.mjs <skills folder> [--division id] [--label "Name"] [--prefix "Name "] [--max 7000] [--skip-risk offensive]'); process.exit(2); }
  const division = flag('--division', 'it-professional'), label = flag('--label', 'IT Professional'), prefix = flag('--prefix', 'IT Professional '), max = Number(flag('--max', 7000)) || 7000;
  const skip = new Set(String(flag('--skip-risk', 'offensive')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)), sourceNote = flag('--source', '');
  const out = path.join(AGENCY, 'personas', division); fs.mkdirSync(out, { recursive: true });
  let written = 0, skipped = 0; const seen = new Set();
  for (const dir of fs.readdirSync(source).sort()) {
    const skill = path.join(source, dir, 'SKILL.md'); if (!fs.existsSync(skill)) continue;
    const persona = personaFromSkill(fs.readFileSync(skill, 'utf8'), { id: dir, prefix, max, source: sourceNote });
    if (skip.has(persona.risk)) { skipped++; continue; }
    let id = persona.id; for (let n = 2; seen.has(id); n++) id = persona.id.slice(0, 44) + '-' + n; seen.add(id);
    fs.writeFileSync(path.join(out, id + '.md'), persona.text); written++;
  }
  const r = reindex({ labels: { [division]: label } });
  console.log(`imported ${written} skills as personas into agency/personas/${division}/ (${skipped} skipped by risk) · index: ${r.personas} personas in ${r.divisions} divisions`);
}
