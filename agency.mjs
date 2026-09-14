// The Agency: a catalogue of ready-made people (from github.com/msitarzewski/agency-agents, MIT), vendored under agency/.
// A persona becomes a person on a team (name, role, job, standing instructions) plus a skill holding its full method,
// or just a skill for teams and people that already exist.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { searchAgency } from './src/agency-search.js';

const DIR = path.join(ROOT, 'agency');
// The catalogue's divisions, in the order the picker lists them. A persona's folder under agency/personas/ is its division.
export const DIVISIONS = {
  engineering: 'Software Engineering', ai: 'AI & Agents', data: 'Data & Analytics', devops: 'DevOps & Cloud', security: 'Security',
  testing: 'Quality & Testing', automation: 'Automation & Integrations', design: 'Design', writing: 'Writing & Documents',
  product: 'Product', 'project-management': 'Project Management', marketing: 'Marketing', 'paid-media': 'Paid Media', sales: 'Sales',
  support: 'Customer Support', finance: 'Finance', business: 'Business & Operations', research: 'Research & Science',
  academic: 'Academic', healthcare: 'Healthcare', gis: 'GIS & Mapping', 'game-development': 'Game Development',
  'spatial-computing': 'Spatial Computing', specialized: 'Specialized',
};
const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const slugOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'persona';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

// Front matter + the sections the personas share (Identity & Memory, Core Mission, Critical Rules, …).
export function parsePersona(markdown, { division = '', file = '' } = {}) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown); if (!fm) return null;
  const meta = {}; for (const line of fm[1].split(/\r?\n/)) { const m = /^([A-Za-z_]+):\s*(.*)$/.exec(line); if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); }
  if (!meta.name) return null;
  const body = fm[2].trim(), sections = {};
  for (const m of body.matchAll(/^##\s+(.+?)\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/gm)) sections[m[1].replace(/[^\w &]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()] = m[2].trim();
  const section = (...names) => names.map(n => sections[Object.keys(sections).find(k => k.includes(n)) || '']).find(Boolean) || '';
  const bullet = (block, label) => (new RegExp(`\\*\\*${label}\\*\\*:?\\s*(.+)`, 'i').exec(block) || [])[1] || '';
  const identity = section('identity');
  const role = text(meta.role || bullet(identity, 'Role') || meta.description.split(/[.—–-]\s/)[0], 120);
  const tags = [...new Set(String(meta.tags || '').split(',').map(t => text(t, 32).toLowerCase()).filter(Boolean))].slice(0, 10);
  const rules = section('critical rules', 'rules'), mission = section('core mission', 'mission', 'core responsibilities');
  const lines = block => block.split('\n').map(l => l.trim()).filter(l => /^[-*]\s/.test(l)).map(l => l.replace(/^[-*]\s+/, '').replace(/\*\*/g, ''));
  const extracted = [...lines(rules), ...lines(mission)].filter(l => l.length > 8 && !/^(Role|Personality|Memory|Experience):/i.test(l)).slice(0, 25).map(l => '- ' + l).join('\n').slice(0, 2000);
  const id = slugOf(file.replace(/\.md$/, '') || meta.name);
  // A persona without rules or mission bullets still needs standing instructions: the office refuses a person without a brief.
  const brief = extracted || [`Your job: ${text(meta.description, 400)}`, meta.vibe ? `Work like this: ${text(meta.vibe, 300)}` : '', `Follow the ${meta.name} method in your skills, step by step, and hand finished work to your lead in the format asked for, with assumptions and blockers named.`].filter(Boolean).join('\n').slice(0, 2000);
  return { id, division, name: meta.name, description: text(meta.description, 500), emoji: meta.emoji || '', vibe: text(meta.vibe, 300), role, tags, does: text(meta.description, 1200), brief, body };
}

export class Agency {
  constructor({ dir = DIR } = {}) { this.dir = dir; this.index = null; }
  load() {
    if (this.index) return this.index;
    try { this.index = JSON.parse(fs.readFileSync(path.join(this.dir, 'index.json'), 'utf8')); } catch { this.index = { divisions: {}, personas: [] }; }
    // Only a persona whose file is here can be hired: one the index names but this copy lacks is left out of the list,
    // rather than offered and then failing (a whole division once went missing from a checkout this way).
    const all = this.index.personas || [], present = all.filter(p => fs.existsSync(this.fileOf(p)));
    if (present.length < all.length) { this.missing = all.filter(p => !present.includes(p)).map(p => p.id); console.warn(`agency: ${this.missing.length} persona${this.missing.length === 1 ? '' : 's'} in the index without a file, left out (${this.missing.slice(0, 5).join(', ')}${this.missing.length > 5 ? ', …' : ''})`); }
    this.index = { ...this.index, personas: present };
    return this.index;
  }
  divisions() { return this.load().divisions; }
  // Best match first: see src/agency-search.js (the hire picker ranks with the same function).
  list({ q = '', division = '' } = {}) { return searchAgency(this.load().personas, { q, division }).map(({ bytes, ...p }) => p); }
  fileOf(entry) { return path.join(this.dir, 'personas', entry.division, entry.id + '.md'); }
  get(id) {
    const entry = this.load().personas.find(p => p.id === id); if (!entry) fail('No such persona.', 404);
    let text; try { text = fs.readFileSync(this.fileOf(entry), 'utf8'); } catch { fail(`${entry.name} is listed but this copy of the Agency does not have the persona's file. Choose another, or ask the administrator to update the catalogue.`, 404); }
    const persona = parsePersona(text, { division: entry.division, file: entry.id + '.md' });
    if (!persona) fail(`${entry.name} could not be read from the catalogue. Choose another persona.`, 422);
    return { ...persona, label: entry.label };
  }
  // The full method as an office skill (instructions are capped; the cut lands on a heading when it can).
  skillOf(persona, { max = 24000 } = {}) {
    let instructions = `# ${persona.name}\n\n${persona.body}`;
    if (instructions.length > max) { const cut = instructions.lastIndexOf('\n## ', max); instructions = instructions.slice(0, cut > max / 2 ? cut : max).trimEnd() + '\n\n(Shortened: the full persona is in the Agency catalogue.)'; }
    return { id: ('agency-' + persona.id).slice(0, 48), name: text(persona.name, 100), description: text(persona.description, 500), instructions };
  }
  // Who in the office came from which persona: { personaId: { dept, team, agent, name, lead } }. A hire records its persona on the
  // person; people hired before that are recognised by the id a hire gives them (agency-<persona>, -2 for a second copy) or, for a
  // lead who took a persona's job, by its method and role together. A method added on its own is not a hire.
  hired(config) {
    const personas = this.load().personas, byId = new Map(personas.map(p => [p.id, p])), out = {};
    const byPersonId = new Map(), bySkill = new Map();
    for (const p of personas) { byPersonId.set(('agency-' + p.id).slice(0, 44), p.id); bySkill.set(('agency-' + p.id).slice(0, 48), p); }
    for (const a of config.agents || []) {
      let id = byId.has(a.persona) ? a.persona : '';
      // A second copy was agency-<first 34 letters of the persona id>-<n>.
      if (!id && /^agency-/.test(a.id)) id = byPersonId.get(a.id) || [...byPersonId.entries()].find(([pid]) => /-\d+$/.test(a.id) && a.id.replace(/-\d+$/, '') === pid.slice(0, 41))?.[1] || '';
      if (!id) id = (a.skills || []).map(s => bySkill.get(s)).find(p => p && text(p.role, 120) === a.role)?.id || '';
      if (!id || out[id]) continue;
      const team = config.teams.find(t => t.id === a.department);
      out[id] = { dept: a.department, team: team?.name || a.department, agent: a.id, name: a.name, lead: team?.lead === a.id };
    }
    return out;
  }
  // A persona joins a team as a specialist (or replaces the lead's job when `lead` is set), with its method as a skill. Once per office:
  // a persona already working somewhere is not hired a second time.
  hire(office, id, { dept, name = '', lead = false, busy = new Set() } = {}) {
    const persona = this.get(id), config = office.get(), team = config.teams.find(t => t.id === dept); if (!team) fail('Choose an existing team.');
    const already = this.hired(config)[persona.id];
    if (already) fail(`${persona.name} is already hired: ${already.name} works on ${already.team}${already.lead ? ' as the lead' : ''}. Open that team to change their work, or remove them there before hiring the persona again.`, 409);
    const skill = this.skillOf(persona);
    if (!config.skills.some(s => s.id === skill.id)) { if (config.skills.length >= 50) fail('The office already has 50 skills; remove one first.'); config.skills.push(skill); }
    let person;
    if (lead) {
      person = config.agents.find(a => a.id === team.lead); if (!person) fail('This team has no lead.');
      Object.assign(person, { role: persona.role, does: persona.does, brief: persona.brief, name: text(name, 48) || person.name, persona: persona.id });
    } else {
      const max = office.limits?.maxMembersPerTeam || 7, members = config.agents.filter(a => a.department === dept); if (members.length >= max) fail(`${team.name} is full: a team is a lead and up to ${max - 1} specialists. Remove someone first.`);
      let pid = ('agency-' + persona.id).slice(0, 44); for (let n = 2; config.agents.some(a => a.id === pid); n++) pid = ('agency-' + persona.id).slice(0, 41) + '-' + n;
      person = { id: pid, department: dept, name: text(name, 48) || text(persona.name, 48).toUpperCase(), role: persona.role, does: persona.does, brief: persona.brief, persona: persona.id, model: '', effort: '', tools: [], inheritTools: true, skills: [], rules: [] };
      config.agents.push(person);
    }
    person.skills = [...new Set([...(person.skills || []), skill.id])];
    const updated = office.update(config, busy);
    return { person: updated.agents.find(a => a.id === person.id), skill: updated.skills.find(s => s.id === skill.id), team: { id: team.id, name: team.name } };
  }
  // The persona's method only, given to teams and people that already exist.
  addSkill(office, id, { teams = [], agents = [], busy = new Set() } = {}) {
    const persona = this.get(id), config = office.get(), skill = this.skillOf(persona);
    if (!config.skills.some(s => s.id === skill.id)) { if (config.skills.length >= 50) fail('The office already has 50 skills; remove one first.'); config.skills.push(skill); }
    for (const t of config.teams) if (teams.includes(t.id)) t.skills = [...new Set([...t.skills, skill.id])];
    for (const a of config.agents) if (agents.includes(a.id)) a.skills = [...new Set([...a.skills, skill.id])];
    const updated = office.update(config, busy);
    return { skill: updated.skills.find(s => s.id === skill.id), teams: updated.teams.filter(t => t.skills.includes(skill.id)).map(t => t.id), agents: updated.agents.filter(a => a.skills.includes(skill.id)).map(a => a.id) };
  }
}
