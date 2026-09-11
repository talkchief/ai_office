// Turn a folder of Agent Skills (one SKILL.md per subfolder) into Agency personas the CEO can hire, then rebuild the Agency index.
//
//   node scripts/import-skills.mjs <skills folder> [--division specialized] [--label "Name"] [--prefix ""] [--max 7000]
//                                  [--skip-risk offensive] [--source "<url> (MIT)"] [--catalogue "Agentic Awesome Skills"]
//   node scripts/import-skills.mjs --reindex        → rebuild agency/index.json from the persona files on disk, nothing else
//
// Each persona is named "<prefix><skill title>", carries the skill's own text as its method (cut at a heading past --max characters),
// and lands in agency/personas/<division>/. An import arrives raw: give every new persona a job title, a role line, one plain
// description, the right division and search tags with scripts/agency-curate.mjs before it ships.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIVISIONS, parsePersona, slugOf } from '../agency.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), AGENCY = path.join(ROOT, 'agency');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback; };

export function readFrontMatter(markdown) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown); if (!fm) return { meta: {}, body: markdown.trim() };
  const meta = {}; for (const line of fm[1].split(/\r?\n/)) { const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(line); if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); }
  return { meta, body: fm[2].trim() };
}
// Words the catalogue spells one way, whatever the skill's folder name did.
const CASING = Object.fromEntries(['AI', 'API', 'APIs', 'QA', 'SQL', 'AWS', 'GCP', 'UI', 'UX', 'SEO', 'E2E', 'LLM', 'LLMs', 'MCP', 'RAG', 'CI', 'CD', 'SaaS', 'iOS', 'macOS', 'GitHub', 'GitLab', 'DevOps', 'JavaScript', 'TypeScript', 'GraphQL', 'PostgreSQL', 'MongoDB', 'MySQL', 'PHP', 'CSS', 'HTML', 'PDF', 'CRM', 'SDK', 'CLI', 'JSON', 'YAML', 'B2B', 'B2C', 'SRE', 'OAuth', 'JWT', 'WordPress', 'WooCommerce', 'HubSpot', 'LinkedIn', 'YouTube', 'TikTok', 'OpenAI', 'ChatGPT', 'FastAPI', 'NestJS', 'k8s'].map(w => [w.toLowerCase(), w]));
Object.assign(CASING, { nodejs: 'Node.js', nextjs: 'Next.js', vuejs: 'Vue.js', dotnet: '.NET', aspnet: 'ASP.NET', csharp: 'C#', cpp: 'C++' });
export const titleOf = name => String(name || '').replace(/^\d+[-_]/, '').replace(/[-_]+/g, ' ').trim().split(/\s+/).map(w => CASING[w.toLowerCase()] || (w.length > 2 || /^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase())).join(' ');
const cutAtHeading = (text, max) => { if (text.length <= max) return text; const cut = text.lastIndexOf('\n## ', max); return text.slice(0, cut > max / 2 ? cut : max).trimEnd() + '\n\n(Shortened: the skill continues in its source.)'; };
const oneLine = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

// The office's persona shape (identity, mission, method, rules) around one skill's own text. `role` and `tags` are optional
// front matter: the curated role line the picker shows under the name, and the words search ranks by.
export function renderSkillPersona({ name, title, description, role = '', tags = [], emoji = '🛠️', category = '', source = '', catalogue = 'Agentic Awesome Skills', method = '' }) {
  const optional = (key, value) => (value ? `${key}: ${oneLine(value, 480)}\n` : '');
  return `---
name: ${name}
description: ${oneLine(description, 480)}
${optional('role', role)}${optional('tags', tags.join(', '))}color: slate
emoji: ${emoji}
vibe: Applies the ${title} skill exactly as written, step by step, and says which step produced what.
source: ${source}
---

# ${name}

You are **${name}**: you carry one skill, "${title}", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: ${role || `${title} specialist${category ? ' (' + category + ')' : ''}`}
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The ${title} skill from the ${catalogue} catalogue${category ? ', ' + category : ''}

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
}

// One persona per skill.
export function personaFromSkill(markdown, { id, division = 'specialized', prefix = '', max = 7000, source = '', catalogue = 'Agentic Awesome Skills' } = {}) {
  const { meta, body } = readFrontMatter(markdown);
  const skillId = meta.id || meta.name || id, title = titleOf(meta.name && !/^\d/.test(meta.name) ? meta.name : skillId), name = `${prefix}${title}`;
  const description = oneLine(meta.description, 480) || `Applies the ${title} skill.`;
  const risk = String(meta.risk || 'safe').toLowerCase(), category = oneLine(meta.category, 40);
  const method = cutAtHeading(body.replace(/^#\s+.+\n/, '').trim(), max);
  const text = renderSkillPersona({ name, title, description, category, catalogue, method, source: `${source ? source + ' · ' : ''}${skillId}` });
  return { id: slugOf(slugOf(`${division}-${skillId}`)), name, title, description, risk, category, text };
}

// Rebuild agency/index.json from the persona files on disk: divisions in the picker's order (DIVISIONS first, any other folder
// after it), personas A–Z within each division.
export function reindex({ labels = {} } = {}) {
  const file = path.join(AGENCY, 'index.json'), old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { divisions: {}, personas: [] };
  const root = path.join(AGENCY, 'personas'), folders = fs.readdirSync(root).filter(d => fs.statSync(path.join(root, d)).isDirectory() && fs.readdirSync(path.join(root, d)).some(f => f.endsWith('.md')));
  const order = [...Object.keys(DIVISIONS).filter(d => folders.includes(d)), ...folders.filter(d => !DIVISIONS[d]).sort()];
  const divisions = Object.fromEntries(order.map(d => [d, DIVISIONS[d] || labels[d] || old.divisions?.[d] || titleOf(d)])), personas = [];
  for (const division of order) {
    const found = [];
    for (const entry of fs.readdirSync(path.join(root, division)).filter(f => f.endsWith('.md'))) {
      const full = path.join(root, division, entry), persona = parsePersona(fs.readFileSync(full, 'utf8'), { division, file: entry });
      if (!persona) { console.warn('skipped (no front matter):', division + '/' + entry); continue; }
      found.push({ id: persona.id, division, label: divisions[division], name: persona.name, description: persona.description, emoji: persona.emoji, role: persona.role, tags: persona.tags, bytes: fs.statSync(full).size });
    }
    personas.push(...found.sort((a, b) => a.name.localeCompare(b.name)));
  }
  fs.writeFileSync(file, JSON.stringify({ source: old.source || 'https://github.com/msitarzewski/agency-agents', license: old.license || 'MIT', syncedAt: new Date().toISOString(), divisions, personas }, null, 1) + '\n');
  return { personas: personas.length, divisions: Object.keys(divisions).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (args.includes('--reindex')) { const r = reindex(); console.log(`agency: ${r.personas} personas in ${r.divisions} divisions → agency/index.json`); process.exit(0); }
  const source = args.find(a => !a.startsWith('--') && (args.indexOf(a) === 0 || !args[args.indexOf(a) - 1].startsWith('--')));
  if (!source || !fs.existsSync(source)) { console.error('usage: node scripts/import-skills.mjs <skills folder> [--division id] [--label "Name"] [--prefix "Name "] [--max 7000] [--skip-risk offensive]'); process.exit(2); }
  const division = flag('--division', 'specialized'), label = flag('--label', DIVISIONS[division] || titleOf(division)), prefix = flag('--prefix', ''), max = Number(flag('--max', 7000)) || 7000;
  const skip = new Set(String(flag('--skip-risk', 'offensive')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)), sourceNote = flag('--source', ''), catalogue = flag('--catalogue', 'Agentic Awesome Skills');
  const out = path.join(AGENCY, 'personas', division); fs.mkdirSync(out, { recursive: true });
  let written = 0, skipped = 0; const seen = new Set();
  for (const dir of fs.readdirSync(source).sort()) {
    const skill = path.join(source, dir, 'SKILL.md'); if (!fs.existsSync(skill)) continue;
    const persona = personaFromSkill(fs.readFileSync(skill, 'utf8'), { id: dir, division, prefix, max, source: sourceNote, catalogue });
    if (skip.has(persona.risk)) { skipped++; continue; }
    let id = persona.id; for (let n = 2; seen.has(id) || fs.existsSync(path.join(out, id + '.md')); n++) id = persona.id.slice(0, 44) + '-' + n; seen.add(id);
    fs.writeFileSync(path.join(out, id + '.md'), persona.text); written++;
  }
  const r = reindex({ labels: { [division]: label } });
  console.log(`imported ${written} skills as personas into agency/personas/${division}/ (${skipped} skipped by risk) · index: ${r.personas} personas in ${r.divisions} divisions\nnext: give them titles, descriptions, divisions and tags with scripts/agency-curate.mjs`);
}
