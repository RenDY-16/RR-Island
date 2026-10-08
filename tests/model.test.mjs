import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarize} from '../extension/model.js';
import * as model from '../extension/model.js';
test('a finished chat never hides another working chat',()=>{
 const r=summarize({sessions:{a:{status:'finished',updated:99},b:{status:'working',updated:98}}},100);
 assert.equal(r.status,'working');assert.equal(r.active,1);
});
test('old working events become uncertain instead of claiming live work',()=>{
 const r=summarize({sessions:{a:{status:'working',updated:1}}},1000);
 assert.equal(r.status,'stale');assert.equal(r.active,0);
});
test('completion settles back to idle',()=>{
 assert.equal(summarize({sessions:{a:{status:'finished',updated:1}}},10).status,'idle');
});
test('limited session list keeps running chats ahead of newer idle chats',()=>{
 assert.equal(typeof model.visibleSessions,'function');
 const result=summarize({sessions:{idle:{status:'idle',updated:99},run:{status:'working',updated:90},old:{status:'idle',updated:80}}},100);
 assert.deepEqual(model.visibleSessions(result,{maxSessions:2,activeOnly:false}).map(s=>s.id),['run','idle']);
});
test('active-only view omits finished and stale chats without changing total',()=>{
 assert.equal(typeof model.visibleSessions,'function');
 const result=summarize({sessions:{done:{status:'finished',updated:99},run:{status:'thinking',updated:90},stale:{status:'working',updated:-900}}},100);
 assert.deepEqual(model.visibleSessions(result,{maxSessions:6,activeOnly:true}).map(s=>s.id),['run']);
 assert.equal(result.sessions.length,3);
});
