import test from 'node:test';
import assert from 'node:assert/strict';
import {PetMotion} from '../extension/pet-motion.js';
test('greeting plays once and resumes work after the original wave sequence',()=>{
 const p=new PetMotion();assert.equal(p.trigger('waving',100,true,1),true);
 assert.equal(p.pose('working',2,200,true,1).status,'waving');
 assert.equal(p.pose('working',2,900,true,1).status,'working');
});
test('reduced motion and calm setting prevent click gestures',()=>{
 const p=new PetMotion();assert.equal(p.trigger('jumping',0,false,1),false);
 assert.equal(p.trigger('jumping',0,true,0),false);
 assert.deepEqual(p.pose('idle',33,500,false,2),{status:'idle',frame:0});
});
