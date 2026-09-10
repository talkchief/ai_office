// Vendors the Agency persona catalogue (github.com/msitarzewski/agency-agents, MIT) into agency/:
//   node scripts/agency-sync.mjs /path/to/agency-agents
// Writes agency/personas/<division>/<slug>.md (only files with agent front matter), agency/index.json, agency/LICENSE,
// and the Program Manager's Deep Agents skills under agency/pm-skills/<slug>/SKILL.md from the project-management personas.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.mjs';
import { parsePersona, slugOf } from '../agency.mjs';

const source = process.argv[2]; if (!source || !fs.existsSync(path.join(source, 'divisions.json'))) { console.error('usage: node scripts/agency-sync.mjs <clone of agency-agents>'); process.exit(1); }
const divisions = JSON.parse(fs.readFileSync(path.join(source, 'divisions.json'), 'utf8')).divisions;
const out = path.join(ROOT, 'agency'), personas = path.join(out, 'personas');
fs.rmSync(personas, { recursive: true, force: true }); fs.mkdirSync(personas, { recursive: true });
const index = [];
for (const division of Object.keys(divisions).sort()) {
  const dir = path.join(source, division); if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8'), persona = parsePersona(text, { division, file });
    if (!persona) continue;
    fs.mkdirSync(path.join(personas, division), { recursive: true });
    fs.writeFileSync(path.join(personas, division, persona.id + '.md'), text);
    index.push({ id: persona.id, division, label: divisions[division].label, name: persona.name, description: persona.description, emoji: persona.emoji, role: persona.role, bytes: text.length });
  }
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ source: 'https://github.com/msitarzewski/agency-agents', license: 'MIT', syncedAt: new Date().toISOString(), divisions: Object.fromEntries(Object.entries(divisions).map(([id, d]) => [id, d.label])), personas: index }, null, 1) + '\n');
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(out, 'LICENSE'));
// The Program Manager's skills: one per project-management persona, in the Agent Skills shape Deep Agents reads on demand.
const pmDir = path.join(ROOT, 'agency', 'pm-skills');
for (const entry of index.filter(p => p.division === 'project-management')) {
  const text = fs.readFileSync(path.join(personas, entry.division, entry.id + '.md'), 'utf8'), body = text.replace(/^---[\s\S]*?---\s*/, '');
  const slug = slugOf(entry.name), dir = path.join(pmDir, slug); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${slug}\ndescription: ${entry.description.replace(/\s+/g, ' ').slice(0, 1000)}\n---\n${body}`);
}
console.log(`agency: ${index.length} personas in ${new Set(index.map(p => p.division)).size} divisions → agency/ · ${index.filter(p => p.division === 'project-management').length} Program Manager skills → agency/pm-skills/`);
