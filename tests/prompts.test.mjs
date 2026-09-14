import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { programManagerPrompt, leadPrompt, specialistPrompt } from '../engine/prompts.mjs';
import { quickLeadPrompt } from '../engine/prompts.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-prompts-'));
const labels = { Google_Calendar: 'Google Calendar', web: 'Web search & fetch' };

// An office where only EMAILS has web access and two teams share the calendar connector.
function officeWithTools() {
  const store = new OfficeStore({ dataDir: temp(), initialAgents: loadRoster().agents });
  const office = store.get();
  office.teams.find(t => t.id === 'emails').tools = ['web', 'Google_Calendar'];
  office.teams.find(t => t.id === 'marketing').tools = ['Google_Calendar'];
  return store.update(office);
}

test('the Program Manager sees the whole company: every team, its people, its purpose and its tools', () => {
  const office = officeWithTools();
  const prompt = programManagerPrompt({ office, name: 'Northgate', teams: office.teams, toolLabels: labels });
  for (const team of office.teams) assert.ok(prompt.includes(team.name), `lists ${team.name}`);
  for (const team of office.teams) assert.ok(prompt.includes(team.purpose.slice(0, 40)), `carries the purpose of ${team.name}`);
  assert.ok(prompt.includes('RESEARCH, Daily Research Agent'), 'names a marketing specialist with their role');
  assert.match(prompt, /EMAILS[\s\S]*Tools: Web search & fetch, Google Calendar/, 'EMAILS shows web and the calendar');
  assert.match(prompt, /MARKETING[\s\S]*Tools: Google Calendar \(no web access: cannot research the internet\)\n/, 'MARKETING shows only the calendar, and that it cannot reach the web');
  assert.match(prompt, /EMAILS[\s\S]*Tools: Web search & fetch, Google Calendar\n/, 'a team with web access carries no such note');
  assert.match(prompt, /Match every package to the Tools line of the team you send it to/, 'the PM is told to route by the tools a team actually has');
  assert.match(prompt, /send the blocking one on its own first/, 'a package that unblocks the next step goes out alone');
  assert.match(prompt, /proposes it with update_brain_note and the CEO approves it before it is written/, 'a Brain change is proposed, never made directly');
  assert.match(prompt, /call assemble_files with the files in order/, 'a combined document is assembled by the office, not by hand');
  assert.match(prompt, /turn the charter's constraints into acceptance criteria in each lead's brief/, 'the charter binds every lead');
  assert.match(prompt, /vault_list shows which services your team may use[\s\S]*You never see, type or ask for a key/, 'the Vault is explained: use it, never see it');
  assert.match(prompt, /db_list shows the database connections your team may use[\s\S]*db_write runs one INSERT, UPDATE or DELETE on a connection the CEO marked writable and pauses for the CEO first[\s\S]*ssh_run runs one command on one of them, always pausing for the CEO first/, 'the database and SSH connectors are explained: reads are free, writes and commands wait for the CEO');
  assert.match(prompt, /make it yourself: assemble_files combines the approved files/, "assembling and exporting approved files is the PM's own work"); assert.match(prompt, /you never write content of your own and you cannot edit files/, "but the PM never authors content");
  assert.match(prompt, /SALES[\s\S]*Tools: none besides the Brain/, 'a team without connectors is told so');
  assert.ok(prompt.includes('a tool only another team has'), 'hand-offs cover missing tools, not just expertise');
  assert.ok(prompt.includes('leads only see their own team, you see all of it'));
});

test('a lead sees its own team and its own tools only, and is told to hand off for a tool it lacks', () => {
  const office = officeWithTools();
  const team = office.teams.find(t => t.id === 'marketing'), lead = office.agents.find(a => a.id === team.lead);
  const specialists = office.agents.filter(a => a.department === team.id && a.id !== team.lead);
  const prompt = leadPrompt({ office, team, lead, specialists, reworkRounds: 3, toolLabels: labels });
  assert.ok(prompt.includes('Tools your team can call: Google Calendar.'));
  assert.ok(!prompt.includes('Web search & fetch'), 'another team’s web access is not shown');
  assert.ok(!prompt.includes('CLIENT EMAILS'), 'another team’s people are not shown');
  assert.ok(prompt.includes('or a tool your team does not have'));
  assert.ok(prompt.includes('never substitute an unrelated tool'));
  assert.ok(prompt.includes(team.purpose), 'the charter is in the prompt');
  assert.ok(prompt.includes(lead.brief.slice(0, 40)), 'the lead’s standing brief is in the prompt');
});

test('a specialist is told its tools, and to stop rather than substitute a tool it does not have', () => {
  const office = officeWithTools();
  const team = office.teams.find(t => t.id === 'marketing'), lead = office.agents.find(a => a.id === team.lead);
  const riley = office.agents.find(a => a.id === 'riley');
  const prompt = specialistPrompt({ office, team, agent: riley, leadAgent: lead, toolLabels: labels });
  assert.ok(prompt.includes('Tools you can call: Google Calendar.'));
  assert.ok(prompt.includes('never use another tool as a substitute'));
  assert.ok(prompt.includes('Never put a password or a key in a statement or a command'), 'a specialist is told the connector rules too');
  const sales = office.teams.find(t => t.id === 'sales'), piper = office.agents.find(a => a.id === 'piper');
  assert.ok(specialistPrompt({ office, team: sales, agent: piper, leadAgent: null, toolLabels: labels }).includes('Tools you can call: none besides the Brain'));
});

test('a person who opted out of a team tool is not told they have it', () => {
  const office = officeWithTools();
  const team = office.teams.find(t => t.id === 'emails');
  const cmail = office.agents.find(a => a.id === 'cmail'); cmail.inheritTools = false; cmail.tools = ['web'];
  const prompt = specialistPrompt({ office, team, agent: cmail, leadAgent: null, toolLabels: labels });
  assert.ok(prompt.includes('Tools you can call: Web search & fetch.'));
  assert.ok(!prompt.includes('Google Calendar'));
});

test('a lead and the Program Manager are told which person has a tool the team lacks', () => {
  const office = officeWithTools();
  const fin = office.teams.find(t => t.id === 'fin'), alead = office.agents.find(a => a.id === fin.lead);
  fin.tools = ['Google_Calendar'];
  const invo = office.agents.find(a => a.id === 'invo'); invo.tools = ['web', 'notion'];
  const specialists = office.agents.filter(a => a.department === 'fin' && a.id !== fin.lead);
  const lead = leadPrompt({ office, team: fin, lead: alead, specialists, reworkRounds: 3, toolLabels: labels });
  assert.ok(lead.includes('Tools your team can call: Google Calendar. INVOICING also has Web search & fetch: delegate work that needs it to them.'), lead.slice(lead.indexOf('Tools your team'), lead.indexOf('Tools your team') + 160));
  const pm = programManagerPrompt({ office, name: 'Northgate', teams: office.teams, toolLabels: labels });
  assert.match(pm, /FINANCE[\s\S]*Tools: Google Calendar; INVOICING also has Web search & fetch/);
  assert.ok(specialistPrompt({ office, team: fin, agent: invo, leadAgent: alead, toolLabels: labels }).includes('Tools you can call: Google Calendar, Web search & fetch.'));
});

test('the Program Manager and the leads are told they convert approved files to PDF, decks and workbooks themselves, and read attachments from their text copies', () => {
  const office = { skills: [], agents: [{ id: 'mlead', name: 'Maya', role: 'Marketing Lead', does: 'Leads.', rules: [], skills: [], tools: [] }], teams: [{ id: 'marketing', name: 'Marketing', lead: 'mlead', purpose: 'Demand.', criteria: ['Cites sources'], guardrails: [], checks: [], tools: [], skills: [], rules: [] }] };
  const pm = programManagerPrompt({ office, teams: office.teams });
  assert.match(pm, /make it yourself: assemble_files combines the approved files/); assert.match(pm, /you never write content of your own/);
  const lead = leadPrompt({ office, team: office.teams[0], lead: office.agents[0], specialists: [], reworkRounds: 3 });
  assert.match(lead, /Converting is not writing: when the CEO wants a PDF, a deck or an Excel workbook of an approved deliverable, export it yourself with export_pdf, export_pptx or export_xlsx/);
  assert.match(pm, /export_xlsx turns tables \(one ## heading per sheet\) into an Excel workbook/);
  // Everyone reads attachments from their text copies, and a file that cannot be read stops the work instead of being worked around.
  for (const text of [pm, lead]) { assert.match(text, /read the text copy the office made beside each one, \/work\/inbox\/<file name>\.md/); assert.match(text, /never replace it with general knowledge, benchmarks or a generic framework/); }
});

test('the quick-lane prompt tells the lead to work alone, export, review and hand the task to the team when it is bigger', () => {
  const office = { skills: [], agents: [], teams: [] }, team = { id: 'marketing', name: 'Marketing', criteria: ['Cites its sources'], guardrails: [], checks: [], tools: [], skills: [], rules: [] }, lead = { id: 'mlead', name: 'Maya', role: 'Marketing Lead', does: 'Leads marketing.', rules: [], skills: [], tools: [] };
  const text = quickLeadPrompt({ office, team, lead });
  assert.match(text, /This is quick work, and you do it yourself/); assert.match(text, /export_pdf/); assert.match(text, /record_review once/); assert.match(text, /needs_the_team/); assert.match(text, /criterion-1: Cites its sources/); assert.match(text, /allows 8 tool calls/);
});
