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

export function readFrontMatter(source) {
  const markdown = String(source).replace(/\r\n?/g, '\n'); // a Windows checkout of a skill catalogue reads the same
  const fm = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(markdown); if (!fm) return { meta: {}, body: markdown.trim() };
  const meta = {}; for (const line of fm[1].split(/\r?\n/)) { const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(line); if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); }
  return { meta, body: fm[2].trim() };
}
// Words the catalogue spells one way, whatever the skill's folder name did.
const CASING = Object.fromEntries(['AI', 'API', 'APIs', 'QA', 'SQL', 'AWS', 'GCP', 'UI', 'UX', 'SEO', 'E2E', 'LLM', 'LLMs', 'MCP', 'RAG', 'CI', 'CD', 'SaaS', 'iOS', 'macOS', 'GitHub', 'GitLab', 'DevOps', 'JavaScript', 'TypeScript', 'GraphQL', 'PostgreSQL', 'MongoDB', 'MySQL', 'PHP', 'CSS', 'HTML', 'PDF', 'CRM', 'SDK', 'CLI', 'JSON', 'YAML', 'B2B', 'B2C', 'SRE', 'OAuth', 'JWT', 'WordPress', 'WooCommerce', 'HubSpot', 'LinkedIn', 'YouTube', 'TikTok', 'OpenAI', 'ChatGPT', 'FastAPI', 'NestJS', 'k8s'].map(w => [w.toLowerCase(), w]));
Object.assign(CASING, { nodejs: 'Node.js', nextjs: 'Next.js', vuejs: 'Vue.js', dotnet: '.NET', aspnet: 'ASP.NET', csharp: 'C#', cpp: 'C++' });
export const titleOf = name => String(name || '').replace(/^\d+[-_]/, '').replace(/[-_]+/g, ' ').trim().split(/\s+/).map(w => CASING[w.toLowerCase()] || (w.length > 2 || /^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase())).join(' ');
// A skill that keeps its procedure in references/*.md or resources/*.md ("Read [the detailed guide](references/detailed-guide.md)
// before …", "If detailed examples are required, open `resources/implementation-playbook.md`.") carries those files inline: an
// agent only ever sees the method, never the skill's folder. Pointer-only lines go, other mentions name the section below,
// and each file becomes a section of its own (the detailed guide first) so the cut lands on a heading.
const REF_LINK = /\[([^\]]*)\]\((?:\.\/)?((?:references|resources)\/[^)#\s]+\.md)(?:#[^)]*)?\)/g;
const REF_PATH = /`?(?<![\w./-])(?:\.\/)?((?:references|resources)\/[A-Za-z0-9_./-]+\.md)`?/g; // not inside a URL
const POINTER = /^[ \t]*(?:[-*][ \t]+)?(?:Read \[the detailed guide\]\([^)]*\)[^\n]*|If detailed [a-z ]+ (?:are|is) required, open `(?:\.\/)?(?:references|resources)\/[^`]+`\.?)[ \t]*(?:\n|$)/gim;
export function inlineReferences(source, dir) {
  if (!dir) return source;
  const body = source.replace(/\r\n?/g, '\n');
  const files = [...new Set([...body.matchAll(REF_LINK)].map(m => m[2]).concat([...body.matchAll(REF_PATH)].map(m => m[1])))]
    .filter(f => fs.existsSync(path.join(dir, f))).sort((a, b) => /detailed-guide\.md$/.test(b) - /detailed-guide\.md$/.test(a));
  const heading = f => (/detailed-guide\.md$/.test(f) ? 'Detailed Guide' : `Reference: ${titleOf(path.basename(f, '.md'))}`);
  let text = body.replace(POINTER, '').replace(/^## Detailed Guide\s*\n(?=\s*(## |$))/m, '').trim();
  for (const f of files) {
    const guide = readFrontMatter(fs.readFileSync(path.join(dir, f), 'utf8')).body.replace(/^#\s+.+\n/, '').replace(/^# /gm, '## ').trim();
    text += `\n\n## ${heading(f)}\n\n${guide}`;
  }
  // Last, over the whole method, the guides included: a file that came inline points at its section, and one the skill names
  // but does not ship is said to be missing, so the specialist does not stop to look for it.
  return text.replace(POINTER, '')
    .replace(REF_LINK, (all, label, f) => (files.includes(f) ? `${label} (see “${heading(f)}” below)` : `${label} (not included)`))
    .replace(REF_PATH, (all, f) => (files.includes(f) ? `“${heading(f)}” below` : `the “${titleOf(path.basename(f, '.md'))}” reference (not included)`)).trim();
}
// Lines the catalogue stamps into every skill ("When you need specialized assistance with this domain", "The task is unrelated
// to …", "Use this skill only when the task clearly matches …"): they say nothing about the method and take room from it.
// A heading left with nothing under it goes too.
const STOCK = [/^When you need specialized assistance with this domain/i, /^The task is unrelated to /i, /^A simpler, more specific tool can handle the request/i,
  /^The user needs general-purpose assistance without domain expertise/i, /^You need a different domain or tool outside this scope/i,
  /^Use this skill only when the task clearly matches/i, /^Do not treat the output as a substitute for environment-specific validation/i,
  /^Stop and ask for clarification if required inputs, permissions, safety boundaries, or success criteria are missing/i,
  /^Clarify goals, constraints, and required inputs/i, /^Apply relevant best practices and validate outcomes/i, /^Provide actionable steps and verification/i,
  /^Working on .{0,60}(tasks|workflows)\.?$/i, /^Use this skill when working on .{0,80}$/i];
// The same, as whole lines rather than bullets: the catalogue's stock trigger sentence and its note about where the text came from.
const STOCK_LINE = [/^This skill is applicable to execute the workflow( or actions)? described in the overview\.?$/i,
  /^>\s*This file contains the detailed procedure and reference material extracted from `?SKILL\.md`?/i,
  /^Working on [^\n]{0,60}(tasks|workflows)\.?$/i, /^Use this skill when working on [^\n]{0,80}$/i];
export function stripStock(body) {
  const lines = body.replace(/\r\n?/g, '\n').split('\n').filter(l => {
    const m = /^\s*[-*]\s+(.*)$/.exec(l);
    if (m && STOCK.some(re => re.test(m[1].trim()))) return false;
    return !STOCK_LINE.some(re => re.test(l.trim()));
  }), out = [];
  for (let i = 0; i < lines.length; i++) {
    const h = /^(#{1,6})\s/.exec(lines[i]);
    if (h) { let j = i + 1; while (j < lines.length && !lines[j].trim()) j++; const next = j < lines.length && /^(#{1,6})\s/.exec(lines[j]); if (j >= lines.length || (next && next[1].length <= h[1].length)) { i = j - 1; continue; } }
    out.push(lines[i]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
export const cutAtHeading = (text, max) => { if (text.length <= max) return text; const cut = text.lastIndexOf('\n## ', max); return text.slice(0, cut > max / 2 ? cut : max).trimEnd() + '\n\n(Shortened: the skill continues in its source.)'; };
const oneLine = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

// The office's persona shape (identity, mission, method, rules) around one skill's own text. `role` and `tags` are optional
// front matter: the curated role line the picker shows under the name, and the words search ranks by.
// `mission` and `rules` are the persona's own standing instructions, written from its method; without them the Core Mission
// is the generic one. The office's operating lines (hand over to the lead, stop when a tool is missing, …) are always there.
export function renderSkillPersona({ name, title, description, role = '', tags = [], emoji = '🛠️', category = '', source = '', catalogue = 'Agentic Awesome Skills', method = '', mission = [], rules = [], authored = false }) {
  const optional = (key, value) => (value ? `${key}: ${oneLine(value, 480)}\n` : '');
  // `authored`: the method was written for the office because the catalogue's own text was not a method. Say so, rather
  // than calling it "the skill, as written".
  const kind = authored ? 'method' : 'skill', methodHeading = authored ? 'The method' : 'The skill, as written';
  const carries = authored ? 'you work by the method below and apply it exactly as it is written' : `you carry one skill, "${title}", and apply it exactly as written`;
  const experience = authored ? `The ${title} method, written for the office${category ? ', ' + category : ''}` : `The ${title} skill from the ${catalogue} catalogue${category ? ', ' + category : ''}`;
  const bullets = list => list.map(b => `- ${oneLine(b, 200)}`).join('\n'), handOver = 'Hand finished work to the lead in the format the skill prescribes, with every assumption stated', stop = 'Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute';
  const missionLines = mission.length ? bullets([...mission, handOver, stop]) : bullets([`Apply the ${title} ${kind} to the assignment, step by step, without skipping a step`, handOver, stop, 'Cite the skill by name in the report so the lead knows which method was applied']);
  const ruleLines = rules.length ? bullets(rules) + '\n' : '';
  return `---
name: ${name}
description: ${oneLine(description, 480)}
${optional('role', role)}${optional('tags', tags.join(', '))}color: slate
emoji: ${emoji}
vibe: Applies the ${title} ${kind} exactly as written, step by step, and says which step produced what.
source: ${source}
---

# ${name}

You are **${name}**: ${carries}. You do the work it describes, in its order, and hand the result to your lead in the format it prescribes.

## 🧠 Your Identity & Memory
- **Role**: ${role || `${title} specialist${category ? ' (' + category + ')' : ''}`}
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the ${kind}'s checklist and the files it touched for the current task
- **Experience**: ${experience}

## 🎯 Core Mission
${missionLines}

## 📋 ${methodHeading}
${method}

## 🚨 Critical Rules
${ruleLines}- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
`;
}

// One persona per skill.
export function personaFromSkill(markdown, { id, dir = '', division = 'specialized', prefix = '', max = 20000, source = '', catalogue = 'Agentic Awesome Skills' } = {}) {
  const { meta, body } = readFrontMatter(markdown);
  const skillId = meta.id || meta.name || id, title = titleOf(meta.name && !/^\d/.test(meta.name) ? meta.name : skillId), name = `${prefix}${title}`;
  const description = oneLine(meta.description, 480) || `Applies the ${title} skill.`;
  const risk = String(meta.risk || 'safe').toLowerCase(), category = oneLine(meta.category, 40);
  const method = cutAtHeading(stripStock(inlineReferences(body.replace(/^#\s+.+\n/, '').trim(), dir)), max);
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
  const division = flag('--division', 'specialized'), label = flag('--label', DIVISIONS[division] || titleOf(division)), prefix = flag('--prefix', ''), max = Number(flag('--max', 20000)) || 20000;
  const skip = new Set(String(flag('--skip-risk', 'offensive')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)), sourceNote = flag('--source', ''), catalogue = flag('--catalogue', 'Agentic Awesome Skills');
  const out = path.join(AGENCY, 'personas', division); fs.mkdirSync(out, { recursive: true });
  let written = 0, skipped = 0; const seen = new Set();
  for (const dir of fs.readdirSync(source).sort()) {
    const skill = path.join(source, dir, 'SKILL.md'); if (!fs.existsSync(skill)) continue;
    const persona = personaFromSkill(fs.readFileSync(skill, 'utf8'), { id: dir, dir: path.join(source, dir), division, prefix, max, source: sourceNote, catalogue });
    if (skip.has(persona.risk)) { skipped++; continue; }
    let id = persona.id; for (let n = 2; seen.has(id) || fs.existsSync(path.join(out, id + '.md')); n++) id = persona.id.slice(0, 44) + '-' + n; seen.add(id);
    fs.writeFileSync(path.join(out, id + '.md'), persona.text); written++;
  }
  const r = reindex({ labels: { [division]: label } });
  console.log(`imported ${written} skills as personas into agency/personas/${division}/ (${skipped} skipped by risk) · index: ${r.personas} personas in ${r.divisions} divisions\nnext: give them titles, descriptions, divisions and tags with scripts/agency-curate.mjs`);
}
