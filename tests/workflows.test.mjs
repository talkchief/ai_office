import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OfficeStore } from '../office-store.mjs';
import { WorkflowEngine, validatePlan } from '../workflows.mjs';
import { KnowledgeStore } from '../knowledge.mjs';
import { loadRoster } from '../roster.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-test-'));
function fixture(options = {}) {
  const dir = options.dir || temp();
  const office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  let completed = 0, workCalls = 0;
  const invoke = async ({ phase, job, agent }) => {
    if (phase === 'plan') return { text: JSON.stringify({ title: 'Verified report', summary: 'Prepare, then review.', subtasks: [
      { title: 'Prepare report', instructions: 'Write the report.', agent: job.agents.find(a => a.id !== job.team.lead).id, dependencies: [], acceptance: ['Contains verified result.'] },
    ] }) };
    if (phase === 'work') { workCalls++; return { text: 'Verified result and evidence.', usage: { input_tokens: 10, output_tokens: 10 } }; }
    return { text: JSON.stringify({ approved: true, summary: 'Reviewed the evidence.', criteria: job.team.criteria.map((_, i) => ({ id: `criterion-${i + 1}`, passed: true, evidence: 'The report contains a verified result.' })), changes: [], deliverable: 'Verified result and evidence.' }) };
  };
  const engine = new WorkflowEngine({ dataDir: dir, office, invoke: options.invoke || invoke, onComplete: async () => { completed++; }, maxConcurrentJobs: 1 });
  return { dir, office, engine, invoke, get completed() { return completed; }, get workCalls() { return workCalls; }, close: async () => { await engine.close(); if (!options.keep) fs.rmSync(dir, { recursive: true, force: true }); } };
}
test('teams support real roster edits and protect the lead/worker separation', () => {
  const dir = temp(), store = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  const config = store.get();
  config.agents.push({ id: 'new-writer', name: 'Writer', role: 'Copywriter', department: 'marketing' });
  config.teams.find(t => t.id === 'marketing').lead = 'new-writer';
  const updated = store.update(config);
  assert.equal(updated.agents.find(a => a.id === 'new-writer').lead, true);
  assert.equal(updated.agents.find(a => a.id === 'mlead').lead, false);
  assert.throws(() => store.update(config), /another tab/);
  const invalid = store.get(); invalid.agents = invalid.agents.filter(a => a.id !== 'new-writer');
  assert.throws(() => store.update(invalid), /Assign a lead/);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('a job is completed only after an independent lead review', async () => {
  const f = fixture();
  try {
    const job = f.engine.create({ dept: 'marketing', text: 'Write a report.', autoStart: false });
    assert.equal(job.state, 'queued'); assert.equal(f.completed, 0);
    const done = await f.engine.run(job.id);
    assert.equal(done.state, 'done'); assert.equal(done.review.approved, true);
    assert.equal(done.calls, 3); assert.equal(f.completed, 1);
    assert.notEqual(done.subtasks[0].agent, done.review.agent);
    assert.deepEqual(done.events.map(e => e.type), ['received','planning','planned','subtask_started','subtask_submitted','review_started','review_passed','completed']);
  } finally { await f.close(); }
});
test('automated acceptance checks can veto a lead approval', async () => {
  const f = fixture();
  try {
    const config = f.office.get(), team = config.teams.find(t => t.id === 'marketing');
    team.maxRevisions = 0; team.checks = [{ type: 'contains', value: 'required missing phrase' }]; f.office.update(config);
    const job = f.engine.create({ dept: 'marketing', text: 'Write a report.', autoStart: false });
    const result = await f.engine.run(job.id);
    assert.equal(result.state, 'blocked'); assert.equal(result.review.approved, false); assert.equal(f.completed, 0);
  } finally { await f.close(); }
});
test('missing review evidence never permits completion', async () => {
  let base;
  const f = fixture({ invoke: async input => input.phase === 'review' ? { text: JSON.stringify({ approved: true, criteria: [], deliverable: 'Some text' }) } : base(input) }); base = f.invoke;
  try {
    const config = f.office.get(); config.teams.find(t => t.id === 'marketing').maxRevisions = 0; f.office.update(config);
    const result = await f.engine.run(f.engine.create({ dept:'marketing',text:'Test',autoStart:false }).id);
    assert.equal(result.state,'blocked'); assert.equal(f.completed,0);
  } finally { await f.close(); }
});
test('human approval survives a restart and resumes the saved checkpoint', async () => {
  const f = fixture({ keep: true }); let next;
  try {
    const job = f.engine.create({ dept:'marketing',text:'Test approval',requireHumanApproval:true,autoStart:false });
    const waiting = await f.engine.run(job.id);
    assert.equal(waiting.state,'waiting'); assert.equal(f.completed,0);
    await f.engine.close();
    next = fixture({ dir:f.dir }); next.engine.recover();
    assert.equal(next.engine.get(job.id).state,'waiting');
    next.engine.approve(job.id);
    await next.engine.running.get(job.id).promise;
    assert.equal(next.engine.get(job.id).state,'done'); assert.equal(next.workCalls,0); assert.equal(next.completed,1);
  } finally { if(next)await next.close(); else { await f.engine.close(); fs.rmSync(f.dir,{recursive:true,force:true}); } }
});
test('failed work stays blocked and an explicit retry preserves completed steps', async () => {
  let base, attempts=0;
  const f = fixture({ invoke: async input => {
    if(input.phase==='work' && attempts++===0)throw new Error('Provider temporarily unavailable.');
    return base(input);
  } }); base=f.invoke;
  try {
    const job=f.engine.create({dept:'marketing',text:'Retry test',autoStart:false});
    assert.equal((await f.engine.run(job.id)).state,'blocked'); assert.equal(f.completed,0);
    f.engine.retry(job.id); await f.engine.running.get(job.id).promise;
    assert.equal(f.engine.get(job.id).state,'done'); assert.equal(f.engine.get(job.id).subtasks[0].attempts,2);
  }finally{await f.close();}
});
test('invalid plans cannot assign the lead as a worker or introduce dependency cycles', () => {
  const agents=[{id:'lead'},{id:'worker'}], team={lead:'lead',maxSubtasks:4};
  const step={title:'x',instructions:'y',acceptance:['z'],agent:'lead'};
  assert.throws(()=>validatePlan({subtasks:[step]},team,agents),/reviewing lead/);
  assert.throws(()=>validatePlan({subtasks:[{...step,agent:'worker',dependencies:['step-1']}]},team,agents),/earlier steps/);
});
test('knowledge is editable, archived from context, and protected from traversal and symlinks', async () => {
  const dir=temp(), store=new KnowledgeStore(dir);
  try{
    const note=await store.save({title:'Purpose',content:'# Purpose\nHelp our customers.'});
    assert.equal(store.list().length,1); assert.match(store.read(note.id).content,/customers/);
    assert.throws(()=>store.read('../outside.md'),/Invalid/);
    fs.symlinkSync('/etc',path.join(dir,'linked')); assert.throws(()=>store.read('linked/test.md'),/Linked/);
    await store.archive(note.id); assert.equal(store.list().length,0); assert.equal(fs.readdirSync(path.join(dir,'.archive')).length,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('reusable skills are versioned and a running task retains its original instructions', async () => {
  const f=fixture();
  try {
    let config=f.office.get();config.skills=[{id:'fact-check',name:'Fact check',instructions:'Use supplied facts.'}];config.teams.find(t=>t.id==='marketing').skills=['fact-check'];f.office.update(config);
    const job=f.engine.create({dept:'marketing',text:'Check facts.',autoStart:false});assert.equal(job.skills[0].revision,1);
    config=f.office.get();config.skills[0].instructions='Require named sources.';f.office.update(config);
    assert.equal(f.office.get().skills[0].revision,2);assert.equal(f.engine.get(job.id).skills[0].instructions,'Use supplied facts.');
    config=f.office.get();config.skills=[];assert.throws(()=>f.office.update(config),/Unassign/);
    config.teams.find(t=>t.id==='marketing').skills=[];f.office.update(config);assert.equal(f.engine.get(job.id).skills.length,1);
  } finally {await f.close();}
});
test('every guardrail must be covered by the lead review',async()=>{
 const f=fixture();
 try{const config=f.office.get(),team=config.teams.find(t=>t.id==='marketing');team.guardrails=['Never claim an email was sent.'];team.maxRevisions=0;f.office.update(config);const done=await f.engine.run(f.engine.create({dept:'marketing',text:'Prepare report.',autoStart:false}).id);assert.equal(done.state,'blocked');assert.equal(done.review.approved,false);}finally{await f.close();}
});
test('a multi-test suite preserves separate outcomes and never enables external tools',async()=>{
 const seen=[];let base;const f=fixture({invoke:async input=>{seen.push(input);return base(input);}});base=f.invoke;
 try{
  const config=f.office.get(),team=config.teams.find(t=>t.id==='marketing');team.maxRevisions=0;team.tools=['web'];team.tests=[{id:'pass',name:'Evidence check',prompt:'Prepare report.',requiredText:['verified result']},{id:'fail',name:'Missing evidence',prompt:'Prepare report.',requiredText:['absent specific requirement']}];f.office.update(config);
  const suite=f.engine.createTestSuite('marketing');assert.equal(suite.jobs.length,2);assert.ok(suite.jobs.every(j=>j.suiteId===suite.id));
  const deadline=Date.now()+3000;while(suite.jobs.some(j=>!['done','blocked'].includes(f.engine.get(j.id).state))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(suite.jobs.map(j=>f.engine.get(j.id).state),['done','blocked']);assert.ok(seen.every(input=>input.tools.length===0));assert.equal(f.engine.get(suite.jobs[0].id).testName,'Evidence check');
 }finally{await f.close();}
});

test('backlog tasks wait, allow edits and capture the current team when started',async()=>{
 const f=fixture();
 try{
  const idea=f.engine.create({dept:'marketing',text:'Original idea',backlog:true});f.engine.pump();assert.equal(f.engine.running.size,0);assert.equal(f.engine.activeAgents().size,0);
  const cfg=f.office.get();cfg.teams.find(t=>t.id==='marketing').purpose='Updated purpose';f.office.update(cfg);
  const queued=f.engine.editQueue(idea.id,{text:'Refined idea',priority:2,state:'queued'});assert.equal(queued.text,'Refined idea');assert.equal(queued.team.purpose,'Updated purpose');assert.equal(queued.officeRevision,2);
  const done=await f.engine.run(idea.id);assert.equal(done.state,'done');assert.throws(()=>f.engine.editQueue(idea.id,{text:'Too late'}),/not started/);
 }finally{await f.close();}
});
test('higher-priority queued tasks run first without exceeding job concurrency',async()=>{
 const f=fixture();
 try{
  const order=[];const invoke=f.engine.invoke;f.engine.invoke=async input=>{if(input.phase==='plan')order.push(input.job.id);return invoke(input);};
  const low=f.engine.create({dept:'marketing',text:'Low',priority:0,autoStart:false}),high=f.engine.create({dept:'marketing',text:'High',priority:2,autoStart:false});f.engine.pump();assert.equal(f.engine.running.size,1);
  const deadline=Date.now()+3000;while(f.engine.get(low.id).state!=='done'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.deepEqual(order,[high.id,low.id]);
 }finally{await f.close();}
});
test('cancellation stops active and waiting workers and cannot produce a completion',async()=>{
 let started;const firstStarted=new Promise(r=>{started=r;});let workCalls=0;let base;
 const f=fixture({invoke:async input=>{
   if(input.phase==='plan'){const worker=input.job.agents.find(a=>a.id!==input.job.team.lead).id;return {text:JSON.stringify({subtasks:[1,2].map(n=>({title:'Work '+n,instructions:'Do work',agent:worker,acceptance:['Deliver output'],dependencies:[]}))})};}
   if(input.phase==='work'){workCalls++;input.onProgress({kind:'text',text:'Unreviewed draft'});started();await new Promise((resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new Error('Cancelled')),{once:true}));}
   return base(input);
 }});base=f.invoke;
 try{const id=f.engine.create({dept:'marketing',text:'Cancel test',autoStart:false}).id;const run=f.engine.run(id);await firstStarted;f.engine.cancel(id);const cancelled=await run;assert.equal(cancelled.state,'cancelled');assert.equal(workCalls,1);assert.equal(f.completed,0);assert.ok(cancelled.subtasks.every(s=>s.state==='cancelled'));assert.equal(f.engine.busy.size,0);assert.ok(!cancelled.events.some(e=>e.type==='completed'));}finally{await f.close();}
});
test('a call budget blocks further model calls even when workers run concurrently',async()=>{
 const f=fixture();let actualCalls=0,base=f.invoke;
 f.engine.invoke=async input=>{actualCalls++;if(input.phase==='plan'){const workers=input.job.agents.filter(a=>a.id!==input.job.team.lead);return {text:JSON.stringify({subtasks:[1,2,3].map((n,i)=>({title:'Work '+n,instructions:'Do work',agent:workers[i].id,acceptance:['Deliver output'],dependencies:[]}))})};}return base(input);};
 try{const cfg=f.office.get(),team=cfg.teams.find(t=>t.id==='marketing');team.maxCalls=3;team.concurrency=3;f.office.update(cfg);const result=await f.engine.run(f.engine.create({dept:'marketing',text:'Budget test',autoStart:false}).id);assert.equal(result.state,'blocked');assert.equal(actualCalls,3);assert.equal(result.calls,3);assert.equal(f.completed,0);}finally{await f.close();}
});

test('completion commits once and cancellation cannot claim to undo a saving deliverable', async () => {
  const f = fixture();
  let entered, release;
  const saving = new Promise(resolve => { entered = resolve; });
  const finish = new Promise(resolve => { release = resolve; });
  let saves = 0;
  f.engine.onComplete = async () => { saves++; entered(); await finish; };
  try {
    const id = f.engine.create({ dept: 'marketing', text: 'Commit test', autoStart: false }).id;
    const running = f.engine.run(id);
    await saving;
    assert.equal(f.engine.get(id).state, 'saving');
    assert.throws(() => f.engine.cancel(id), { status: 409 });
    release();
    const result = await running;
    assert.equal(result.state, 'done');
    assert.equal(saves, 1);
    assert.equal(result.events.filter(e => e.type === 'completed').length, 1);
    assert.ok(!result.events.some(e => e.type === 'cancelled'));
  } finally { release(); await f.close(); }
});

test('public drafts appear before a worker returns and remain bounded', async () => {
  const f = fixture();
  let entered, release;
  const working = new Promise(resolve => { entered = resolve; });
  const finish = new Promise(resolve => { release = resolve; });
  f.engine.invoke = async input => {
    if (input.phase === 'work') {
      input.onProgress({ kind: 'text', text: 'First public paragraph.' });
      entered(input.agent.id);
      await finish;
      input.onProgress({ kind: 'text', text: 'x'.repeat(30000) });
    }
    return f.invoke(input);
  };
  try {
    const id = f.engine.create({ dept: 'marketing', text: 'Draft test', autoStart: false }).id;
    const running = f.engine.run(id), worker = await working;
    assert.equal(f.engine.get(id).liveCalls[worker].preview, 'First public paragraph.');
    assert.equal(f.engine.get(id).review, null);
    release();
    const done = await running;
    assert.equal(done.liveCalls[worker].preview.length, 16000);
    assert.equal(done.liveCalls[worker].state, 'returned');
    assert.equal(done.liveCalls[done.team.lead].preview, '');
  } finally { release(); await f.close(); }
});

test('dependent work receives upstream output and repeats when that output needs correction', async () => {
  const f = fixture();
  const order = [];
  let reviews = 0;
  f.engine.invoke = async input => {
    if (input.phase === 'plan') {
      const workers = input.job.agents.filter(a => a.id !== input.job.team.lead);
      return { text: JSON.stringify({ subtasks: [1, 2].map((n, i) => ({
        title: 'Step ' + n, instructions: 'Produce evidence.', agent: workers[i].id,
        acceptance: ['Uses verified facts.'], dependencies: i ? ['step-1'] : [],
      })) }) };
    }
    if (input.phase === 'work') {
      const step = input.job.subtasks.find(s => s.agent === input.agent.id && s.state === 'working');
      order.push(step.id);
      if (step.id === 'step-2') assert.match(input.prompt, /upstream-evidence/);
      return { text: step.id === 'step-1' ? 'upstream-evidence' : 'dependent-deliverable' };
    }
    if (reviews++ === 0) return { text: JSON.stringify({ approved: false, summary: 'Correct the source.', changes: [{ subtask: 'step-1', feedback: 'Check the source again.' }] }) };
    return f.invoke(input);
  };
  try {
    const done = await f.engine.run(f.engine.create({ dept: 'marketing', text: 'Dependency test', autoStart: false }).id);
    assert.equal(done.state, 'done');
    assert.deepEqual(order, ['step-1', 'step-2', 'step-1', 'step-2']);
    assert.equal(done.revisions, 1);
    assert.ok(done.subtasks.every(s => s.attempts === 2));
    assert.equal(f.completed, 1);
  } finally { await f.close(); }
});
