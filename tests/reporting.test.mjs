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
