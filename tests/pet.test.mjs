import test from 'node:test';
import assert from 'node:assert/strict';
import {petFrame} from '../extension/pet-model.js';
test('active pet uses real atlas rows for each Codex state',()=>{
 for(const [status,row] of [['idle',0],['working',7],['thinking',7],['finished',8],['error',5],['stale',6]])assert.equal(petFrame(status,0,true).row,row);
});
test('idle animates across populated frames and loops',()=>{
 assert.equal(petFrame('idle',0,true).column,0);
 assert.equal(petFrame('idle',300,true).column,1);
 assert.equal(petFrame('idle',1100,true).column,0);
 for(let t=0;t<4000;t+=20)assert.ok(petFrame('idle',t,true).column<6);
});
test('reduced motion always shows one stable frame',()=>{
 assert.deepEqual(petFrame('working',900,false),petFrame('working',0,false));
});
