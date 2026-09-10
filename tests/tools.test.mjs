import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolStore } from '../tool-store.mjs';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { layoutGraph } from '../graph-build.mjs';

test('MCP CRUD keeps credentials private, retains tokens when editing and removes assignments', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'space-tools-')); const office=new OfficeStore({dataDir:dir,initialAgents:loadRoster().agents}), commands=[];
 const store=new ToolStore({dataDir:dir,cwd:dir,office,discover:async()=>{},execCommand:async(_,args)=>{commands.push(args);return {stdout:''};}});
 try {
  let list=await store.save({name:'test-mcp',type:'http',url:'https://example.com/mcp',token:'private-token'});
  assert.equal(list.find(t=>t.id==='test_mcp').hasToken,true);assert.ok(!JSON.stringify(list).includes('private-token'));
  await store.save({name:'test-mcp',type:'http',url:'https://example.com/v2',token:''});assert.equal(store.items[0].config.headers.Authorization,'Bearer private-token');
  const cfg=office.get();cfg.teams[0].tools=['test_mcp'];cfg.agents[0].tools=['test_mcp'];office.update(cfg);
  await store.remove('test_mcp');assert.deepEqual(office.get().teams[0].tools,[]);assert.deepEqual(office.get().agents[0].tools,[]);assert.equal(store.items.length,0);
  assert.ok(commands.every(a=>a.includes('--scope')&&a.includes('user')));
  await assert.rejects(store.save({name:'bad',type:'http',url:'https://user:password@example.com'}),/credentials/);
 } finally {store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('a failed MCP edit restores the previous CLI configuration',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'space-tools-')),office=new OfficeStore({dataDir:dir,initialAgents:loadRoster().agents});let fail=false,restored=false;
 const store=new ToolStore({dataDir:dir,cwd:dir,office,discover:async()=>{},execCommand:async(_,args)=>{if(args[1]==='add-json'){const c=JSON.parse(args.at(-1));if(fail&&c.url.includes('broken'))throw new Error('save failed');if(fail&&c.url.includes('working'))restored=true;}return {stdout:''};}});
 try{await store.save({name:'service',type:'http',url:'https://example.com/working'});fail=true;await assert.rejects(store.save({name:'service',type:'http',url:'https://example.com/broken'}));assert.equal(restored,true);assert.match(store.items[0].config.url,/working/);}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('the Brain includes standalone notes and an empty vault has no sample graph',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'space-graph-'));
 try{let g=await layoutGraph(dir);assert.deepEqual(g.nodes,[]);fs.writeFileSync(path.join(dir,'purpose.md'),'# Purpose\nFacts without links.');g=await layoutGraph(dir);assert.equal(g.notes,1);assert.equal(g.nodes.length,1);assert.equal(g.nodes[0].d,0);assert.ok(Number.isFinite(g.nodes[0].x));assert.ok(g.floor[0].every(Number.isFinite));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
