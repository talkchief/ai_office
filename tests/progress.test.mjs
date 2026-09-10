import test from 'node:test';
import assert from 'node:assert/strict';
import { publicProgress } from '../live-progress.mjs';
test('previews accept public text and tool names while excluding reasoning and tool payloads',()=>{
 const chunk=delta=>({type:'stream_event',event:{type:'content_block_delta',delta}});
 assert.deepEqual(publicProgress(chunk({type:'text_delta',text:'Draft paragraph'})),{kind:'text',text:'Draft paragraph'});
 assert.equal(publicProgress(chunk({type:'thinking_delta',thinking:'Private reasoning'})),null);
 assert.equal(publicProgress(chunk({type:'input_json_delta',partial_json:'{"password":"secret"}'})),null);
 assert.deepEqual(publicProgress({type:'stream_event',event:{type:'content_block_start',content_block:{type:'tool_use',name:'lookup',input:{secret:'hidden'}}}}),{kind:'tool',name:'lookup'});
 assert.equal(publicProgress({type:'result',result:'Full internal envelope'}),null);
});
