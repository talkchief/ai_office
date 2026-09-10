// The Agency: a catalogue of ready-made people (from github.com/msitarzewski/agency-agents, MIT), vendored under agency/.
// A persona becomes a person on a team (name, role, job, standing instructions) plus a skill holding its full method,
// or just a skill for teams and people that already exist.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';

const DIR = path.join(ROOT, 'agency');
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
  const role = text(bullet(identity, 'Role') || meta.description.split(/[.—–-]\s/)[0], 120);
  const rules = section('critical rules', 'rules'), mission = section('core mission', 'mission', 'core responsibilities');
  const lines = block => block.split('\n').map(l => l.trim()).filter(l => /^[-*]\s/.test(l)).map(l => l.replace(/^[-*]\s+/, '').replace(/\*\*/g, ''));
  const extracted = [...lines(rules), ...lines(mission)].filter(l => l.length > 8 && !/^(Role|Personality|Memory|Experience):/i.test(l)).slice(0, 25).map(l => '- ' + l).join('\n').slice(0, 2000);
  const id = slugOf(file.replace(/\.md$/, '') || meta.name);
  // A persona without rules or mission bullets still needs standing instructions: the office refuses a person without a brief.
  const brief = extracted || [`Your job: ${text(meta.description, 400)}`, meta.vibe ? `Work like this: ${text(meta.vibe, 300)}` : '', `Follow the ${meta.name} method in your skills, step by step, and hand finished work to your lead in the format asked for, with assumptions and blockers named.`].filter(Boolean).join('\n').slice(0, 2000);
  return { id, division, name: meta.name, description: text(meta.description, 500), emoji: meta.emoji || '', vibe: text(meta.vibe, 300), role, does: text(meta.description, 1200), brief, body };
}

export class Agency {
  constructor({ dir = DIR } = {}) { this.dir = dir; this.index = null; }
  load() {
    if (this.index) return this.index;
    try { this.index = JSON.parse(fs.readFileSync(path.join(this.dir, 'index.json'), 'utf8')); } catch { this.index = { divisions: {}, personas: [] }; }
    return this.index;
  }
  divisions() { return this.load().divisions; }
  list({ q = '', division = '' } = {}) {
    const needle = String(q).toLowerCase().trim();
    return this.load().personas.filter(p => (!division || p.division === division) && (!needle || `${p.name} ${p.description} ${p.role} ${p.label}`.toLowerCase().includes(needle)))
      .map(({ bytes, ...p }) => p);
  }
  get(id) {
    const entry = this.load().personas.find(p => p.id === id); if (!entry) fail('No such persona.', 404);
    const file = path.join(this.dir, 'personas', entry.division, entry.id + '.md');
    const persona = parsePersona(fs.readFileSync(file, 'utf8'), { division: entry.division, file: entry.id + '.md' });
    return { ...persona, label: entry.label };
  }
  // The full method as an office skill (instructions are capped; the cut lands on a heading when it can).
  skillOf(persona, { max = 10000 } = {}) {
    let instructions = `# ${persona.name}\n\n${persona.body}`;
    if (instructions.length > max) { const cut = instructions.lastIndexOf('\n## ', max); instructions = instructions.slice(0, cut > max / 2 ? cut : max).trimEnd() + '\n\n(Shortened: the full persona is in the Agency catalogue.)'; }
    return { id: ('agency-' + persona.id).slice(0, 48), name: text(persona.name, 100), description: text(persona.description, 500), instructions };
  }
  // A persona joins a team as a specialist (or replaces the lead's job when `lead` is set), with its method as a skill.
  hire(office, id, { dept, name = '', lead = false, busy = new Set() } = {}) {
    const persona = this.get(id), config = office.get(), team = config.teams.find(t => t.id === dept); if (!team) fail('Choose an existing team.');
    const skill = this.skillOf(persona);
    if (!config.skills.some(s => s.id === skill.id)) { if (config.skills.length >= 50) fail('The office already has 50 skills; remove one first.'); config.skills.push(skill); }
    let person;
    if (lead) {
      person = config.agents.find(a => a.id === team.lead); if (!person) fail('This team has no lead.');
      Object.assign(person, { role: persona.role, does: persona.does, brief: persona.brief, name: text(name, 48) || person.name });
    } else {
      const members = config.agents.filter(a => a.department === dept); if (members.length >= 7) fail(`${team.name} is full: a team is a lead and up to six specialists. Remove someone first.`);
      let pid = ('agency-' + persona.id).slice(0, 44); for (let n = 2; config.agents.some(a => a.id === pid); n++) pid = ('agency-' + persona.id).slice(0, 41) + '-' + n;
      person = { id: pid, department: dept, name: text(name, 48) || text(persona.name, 48).toUpperCase(), role: persona.role, does: persona.does, brief: persona.brief, model: '', effort: '', tools: [], inheritTools: true, skills: [], rules: [] };
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
