import test from 'node:test';
import assert from 'node:assert/strict';
import { officeReport } from '../reporting.mjs';
import { workingInstructions } from '../office-store.mjs';
test('reports distinguish tasks from tests, use recorded timestamps and preserve blockers',()=>{
 const now=1_800_000_000_000;const office={teams:[{id:'marketing',name:'Marketing',lead:'lead',maxCalls:10,maxTokens:60000,concurrency:2}],agents:[{id:'lead',name:'Lead',department:'marketing'},{id:'worker',name:'Writer',department:'marketing'}]};
 const base={dept:'marketing',createdAt:now-100000,subtasks:[],reviews:[],calls:2,tokens:100,revisions:0};
 const jobs=[{...base,id:'done',state:'done',doneAt:now-50000,subtasks:[{agent:'worker',state:'done'}],reviews:[{agent:'lead'}]},{...base,id:'blocked',state:'blocked',error:'Missing source.'},{...base,id:'test',kind:'evaluation',suiteId:'suite',state:'done',testName:'Sanity test'},{...base,id:'old',createdAt:now-100*86400000,state:'done',doneAt:now-99*86400000}];
 const report=officeReport({jobs,office,now});assert.equal(report.summary.total,2);assert.equal(report.summary.approved,1);assert.equal(report.summary.medianCycleMs,50000);assert.equal(report.summary.tokens,200);assert.equal(report.tests.approved,1);assert.equal(report.attention[0].reason,'Missing source.');assert.equal(report.suites[0].jobs[0].name,'Sanity test');assert.equal(report.teams[0].agents[1].submitted,1);
 assert.equal(officeReport({jobs:[],office,now}).summary.medianCycleMs,null);assert.throws(()=>officeReport({jobs,office,now,days:-5}),/Choose/);
});
test('agent instructions include only assigned skills, team purpose and guardrails',()=>{
 const prompt=workingInstructions({purpose:'Reliable research',instructions:'Cite sources',guardrails:['Do not invent facts'],skills:['research']},{brief:'Check dates',skills:[]},[{id:'research',name:'Research',revision:2,instructions:'Compare primary sources'},{id:'other',name:'Unused',revision:1,instructions:'Unrelated instruction'}]);
 assert.match(prompt,/Reliable research/);assert.match(prompt,/Do not invent facts/);assert.match(prompt,/Compare primary sources/);assert.doesNotMatch(prompt,/Unrelated instruction/);
});
import { kpis, timeInStates } from '../reporting.mjs';
test('KPIs measure throughput, cycle time, waiting on the lead and the CEO, rework, blocked age, load and tokens', () => {
  const H = 3600000, now = 1_800_000_000_000;
  const office = { teams: [{ id: 'sales', name: 'Sales' }], agents: [{ id: 'lead', name: 'Lead', department: 'sales' }, { id: 'rep', name: 'Rep', department: 'sales' }] };
  const jobs = [
    { id: 'a', dept: 'sales', depts: ['sales'], state: 'done', createdAt: now - 10 * H, doneAt: now - 6 * H, reviews: [{ approved: false }, { approved: true }], tokensByModel: { 'z-ai/glm-4.6': 1200 }, runs: [{ agent: 'rep', state: 'done', startedAt: now - 9 * H, finishedAt: now - 8 * H }] },
    { id: 'b', dept: 'sales', depts: ['sales'], state: 'done', createdAt: now - 5 * H, doneAt: now - 3 * H, reviews: [{ approved: true }], tokensByModel: { 'z-ai/glm-4.6': 300, 'claude-opus-5': 50 }, runs: [] },
    { id: 'c', dept: 'sales', depts: ['sales'], state: 'blocked', stateSince: now - 2 * H, createdAt: now - 2 * H, dueAt: now - H, reviews: [], runs: [{ agent: 'rep', state: 'working', startedAt: now - H }] },
    { id: 't', dept: 'sales', kind: 'evaluation', state: 'done', createdAt: now - H, doneAt: now, reviews: [], runs: [] },
  ];
  const ev = { a: [{ type: 'state_changed', to: 'working', at: now - 10 * H }, { type: 'state_changed', to: 'awaiting_lead_review', at: now - 8 * H }, { type: 'state_changed', to: 'awaiting_ceo', at: now - 7 * H }, { type: 'state_changed', to: 'done', at: now - 6 * H }],
    b: [{ type: 'state_changed', to: 'reviewing', at: now - 4 * H }, { type: 'state_changed', to: 'done', at: now - 3 * H }], c: [] };
  const k = kpis({ jobs, events: id => ev[id] || [], office, days: 7, now });
  assert.equal(k.throughput.done, 2); assert.equal(k.cycle.p50, 2 * H); assert.equal(k.cycle.p90, 4 * H);
  assert.equal(k.leadReviewMs, H); assert.equal(k.ceoLatencyMs, H); assert.equal(k.reworkRate, 0.5);
  assert.equal(k.blockedAgeMs, 2 * H); assert.equal(k.overdue, 1); assert.equal(k.needsYou, 1);
  assert.deepEqual(k.tokensByModel, { 'z-ai/glm-4.6': 1500, 'claude-opus-5': 50 });
  assert.deepEqual(k.agents.map(a => [a.id, a.active, a.runs, a.avgRunMs]), [['rep', 1, 2, H]]);
  assert.equal(k.teams[0].done, 2); assert.equal(k.throughput.series.length, 7);
  assert.deepEqual(timeInStates([{ type: 'state_changed', to: 'working', at: 0 }], 5), { working: 5 });
});
