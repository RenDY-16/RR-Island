import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../extension/model.js';
test('remaining quota clamps usage and preserves missing windows',()=>{
 assert.equal(typeof m.usageWindows,'function');
 const rows=m.usageWindows({rateLimitsByLimitId:{codex:{primary:{usedPercent:120,windowDurationMins:300,resetsAt:1000},secondary:null}}});
 assert.equal(rows[0].remaining,0);assert.equal(rows[0].label,'5 jam');assert.equal(rows[1].remaining,null);
});
test('missing or invalid percent never claims a full available quota',()=>{
 assert.equal(typeof m.usageWindows,'function');
 for (const usedPercent of [null,undefined,'25',NaN]) {
  assert.equal(m.usageWindows({rateLimits:{primary:{usedPercent,windowDurationMins:60}}})[0].remaining,null);
 }
});
test('each account bucket uses returned durations rather than assumed labels',()=>{
 assert.equal(typeof m.usageWindows,'function');
 const rows=m.usageWindows({rateLimitsByLimitId:{codex:{primary:{usedPercent:35,windowDurationMins:10080}},other:{primary:{usedPercent:20,windowDurationMins:30}}}});
 assert.equal(rows[0].remaining,65);assert.equal(rows[0].label,'Mingguan');assert.equal(rows[2].label,'30 menit');
});
test('authoritative message replaces deltas without duplicating reply',()=>{
 assert.equal(typeof m.applyMessage,'function');
 const messages={};m.applyMessage(messages,{event:'delta',itemId:'a',text:'Hal'});m.applyMessage(messages,{event:'delta',itemId:'a',text:'o'});
 assert.equal(messages.a,'Halo');m.applyMessage(messages,{event:'message',itemId:'a',text:'Halo!'});assert.equal(messages.a,'Halo!');
 m.applyMessage(messages,{event:'delta',itemId:'a',text:'x'.repeat(20000)});assert.equal(messages.a.length,16000);
});
