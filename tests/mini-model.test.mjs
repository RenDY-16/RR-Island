import test from 'node:test';
import assert from 'node:assert/strict';
import {Conversation,ChatSessions,shouldSubmit,chatRows,prependPage} from '../extension/mini-model.js';
test('new turn preserves earlier bubbles and completed messages replace streamed text',()=>{
 const c=new Conversation();c.load([{role:'Kamu',text:'sebelum'},{role:'Codex',text:'jawaban awal'}]);
 c.begin('pesan baru');c.receive({event:'delta',itemId:'m',text:'Halo'});c.receive({event:'delta',itemId:'m',text:' dunia'});c.receive({event:'message',itemId:'m',text:'Halo dunia'});
 assert.deepEqual(c.rows.map(r=>r.text),['sebelum','jawaban awal','pesan baru','Halo dunia']);
 c.begin('lanjut');c.receive({event:'message',itemId:'m',text:'Turn kedua'});
 assert.equal(c.rows.at(-3).text,'Halo dunia');assert.equal(c.rows.at(-1).text,'Turn kedua');
});
test('failed send retains the unsent bubble and history does not overwrite new messages',()=>{
 const c=new Conversation();c.begin('draft');c.reject();c.load([{role:'Codex',text:'history late'}]);
 assert.equal(c.rows.length,1);assert.equal(c.rows[0].failed,true);assert.equal(c.rows[0].text,'draft');
});
test('chat search and pins do not mutate server order or duplicate rows',()=>{
 const rows=[{id:'a',title:'Kampus',project:'kuliah'},{id:'b',title:'Fedora',project:'desktop'}];
 assert.deepEqual(chatRows(rows,['b'],'').map(r=>r.id),['b','a']);
 assert.deepEqual(chatRows(rows,['b'],'FED').map(r=>r.id),['b']);
 assert.deepEqual(rows.map(r=>r.id),['a','b']);
});
test('older page merges chronologically and removes overlap by stable item id',()=>{
 const newer=[{id:'b',role:'Codex',text:'kedua'}];
 assert.deepEqual(prependPage([{id:'a',role:'Kamu',text:'awal'},{id:'b',role:'Codex',text:'kedua'}],newer).map(r=>r.text),['awal','kedua']);
});
test('long live messages retain a preview marker through streaming and final replacement',()=>{
 const c=new Conversation();c.begin('halo');
 c.receive({event:'delta',itemId:'m',text:'x'.repeat(16000)});
 c.receive({event:'delta',itemId:'m',text:'tail'});
 assert.equal(c.rows.at(-1).text.length,16000);assert.equal(c.rows.at(-1).truncated,true);
 c.receive({event:'message',itemId:'m',text:'short preview',truncated:true});
 assert.equal(c.rows.at(-1).truncated,true);
 c.receive({event:'message',itemId:'m',text:'complete'});
 assert.equal(c.rows.at(-1).truncated,false);
});
test('drafts and replies remain associated with their selected chat',()=>{
 const chats=new ChatSessions();
 chats.saveDraft('mini','mini draft');chats.saveDraft('old-a','draft A');chats.saveDraft('old-b','draft B');
 chats.get('old-a').begin('A sent');chats.get('old-a').receive({event:'message',itemId:'reply',text:'reply A'});
 assert.equal(chats.draft('old-a'),'draft A');assert.equal(chats.draft('old-b'),'draft B');assert.equal(chats.draft('mini'),'mini draft');
 assert.equal(chats.get('old-b').rows.length,0);assert.equal(chats.get('old-a').rows.at(-1).text,'reply A');
 chats.acceptDraft('old-a','A sent');assert.equal(chats.draft('old-a'),'draft A');
 chats.acceptDraft('old-b','draft B');assert.equal(chats.draft('old-b'),'');
});
test('refresh shows desktop history changes while preserving unsent failure bubbles',()=>{
 const c=new Conversation();c.load([{id:'a',role:'Codex',text:'before'}]);c.begin('not sent');c.reject();
 c.refresh([{id:'a',role:'Codex',text:'before'},{id:'b',role:'Codex',text:'desktop update'}]);
 assert.deepEqual(c.rows.map(r=>r.text),['before','desktop update','not sent']);assert.equal(c.rows.at(-1).failed,true);
});
test('evicting transcript cache retains drafts and the active chat',()=>{
 const chats=new ChatSessions();chats.saveDraft('old-a','keep draft');chats.get('old-a').begin('active message');
 for(let i=0;i<30;i++)chats.get(`other-${i}`,'old-a');
 assert.ok(chats.conversations.size<=16);assert.equal(chats.get('old-a').rows[0].text,'active message');assert.equal(chats.draft('old-a'),'keep draft');
});
test('multiline send preference prevents accidental Enter sends',()=>{
 assert.equal(shouldSubmit(false,false,false),false);
 assert.equal(shouldSubmit(false,false,true),true);
 assert.equal(shouldSubmit(true,false,false),true);
 assert.equal(shouldSubmit(true,true,false),false);
 assert.equal(shouldSubmit(false,true,true),false);
});
