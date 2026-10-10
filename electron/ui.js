import {Conversation} from '../extension/mini-model.js';
import {summarize, usageWindows} from '../extension/model.js';
import {petFrame} from '../extension/pet-model.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const pages=['activity','mini','usage','settings'];
const labels={activity:'Aktivitas',mini:'Mini chat',usage:'Usage',settings:'Pengaturan'};
const conversations=new Map([['mini',new Conversation()]]);
const drafts=new Map();
let settings={cwd:'',enterToSend:true,hooksEnabled:false};
let statusData={sessions:{}};
let activePage='activity';
let connectionState='connecting';
let selectedChat=null;
let chatRows=[];
let chatCursor=null;
let historyCursor=null;
let currentTarget='mini';
let sendingTarget=null;
let busy=false;
let petState='idle';
let petFrameIndex=0;
let usageUpdated=0;
let historyLoaded=false;

function say(element,text){element.textContent=text??'';}
function conversation(key){if(!conversations.has(key))conversations.set(key,new Conversation());return conversations.get(key);}
function showPage(page){
  if(!pages.includes(page))return;
  activePage=page;
  for(const name of pages){$(`#page-${name}`).classList.toggle('active-page',name===page);}
  $$('[data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page===page));
  say($('#page-title'),labels[page]);
  if(page==='mini'&&!historyLoaded)void loadHistory();
  if(page==='usage'&&!usageUpdated)void refreshUsage();
  if(page==='activity')renderActivity();
}
$$('[data-page]').forEach(button=>button.addEventListener('click',()=>showPage(button.dataset.page)));

function setConnection(state,text){
  connectionState=state;
  const badge=$('#connection');badge.className=`connection ${state}`;
  say(badge.querySelector('span'),text||({ready:'Tersambung',connecting:'Menyambung…',error:'Terputus',idle:'Siaga'}[state]||state));
  $('#reconnect').classList.toggle('hidden',state==='ready'||state==='connecting');
}
$('#reconnect').addEventListener('click',async()=>{try{await window.island.request('connect');setConnection('ready','Tersambung ke Codex');}catch(error){setConnection('error',error.message);}});

function statusName(value){return ({working:'Sedang bekerja',thinking:'Berpikir',finished:'Selesai',error:'Perlu perhatian',stale:'Status lama',idle:'Siaga'})[value]||'Siaga';}
function renderActivity(){
  const result=summarize(statusData,Date.now()/1000);
  const active=result.sessions.filter(s=>['working','thinking'].includes(s.status)).length;
  const title=active?`${active} sesi Codex aktif`:'Siap menemani sesi Codex.';
  const description=active?'Status sesi dibaca dari hook lokal di perangkat ini.':'Aktifkan pemantauan lokal untuk menampilkan status sesi Codex.';
  say($('#activity-title'),title);say($('#activity-description'),description);
  const list=$('#session-list');list.replaceChildren();
  if(result.sessions.length===0){
    const empty=document.createElement('div');empty.className='session-card';
    const main=document.createElement('div');main.className='session-main';
    const strong=document.createElement('strong');say(strong,'Belum ada aktivitas terbaru');
    const small=document.createElement('small');say(small,settings.hooksEnabled?'Jalankan Codex CLI untuk melihat sesi di sini.':'Aktifkan hook lokal di Pengaturan untuk melihat aktivitas.');
    main.append(strong,small);empty.append(main);list.append(empty);
  }else{
    for(const session of result.sessions){
      const card=document.createElement('div');card.className='session-card';
      const dot=document.createElement('i');dot.className=`status-dot ${session.status}`;
      const main=document.createElement('div');main.className='session-main';
      const name=document.createElement('strong');say(name,session.project||'Codex');
      const meta=document.createElement('small');say(meta,session.tool?`Tool: ${session.tool}`:`Diperbarui ${new Date(session.updated*1000).toLocaleTimeString()}`);
      main.append(name,meta);const badge=document.createElement('span');badge.className='status-label';say(badge,statusName(session.status));card.append(dot,main,badge);list.append(card);
    }
  }
  $('#no-hooks').classList.toggle('hidden',settings.hooksEnabled);
}

function renderPet(){
  const frame=petFrame(petState,petFrameIndex*120,true);
  $('#pet').style.backgroundPosition=`-${frame.column*144}px -${frame.row*156}px`;
  $('#pet').dataset.state=petState;
}
setInterval(()=>{petFrameIndex=(petFrameIndex+1)%96;renderPet();},120);

function renderMessages(key=currentTarget){
  const area=$('#messages');area.replaceChildren();
  const rows=conversation(key).rows;
  for(const row of rows){
    const bubble=document.createElement('article');bubble.className=`message ${row.role==='Kamu'?'user':''} ${row.failed?'failed':''}`;
    const role=document.createElement('div');role.className='role';say(role,row.role==='Kamu'?'KAMU':'CODEX');
    const body=document.createElement('p');say(body,row.text||'');bubble.append(role,body);area.append(bubble);
  }
  area.scrollTop=area.scrollHeight;
}
function renderChatHeader(){
  say($('#chat-title'),selectedChat?.title||'Mini');
  say($('#chat-subtitle'),selectedChat?'Chat lama · mengikuti izin yang tersimpan di Codex':'Chat lokal baru · tersambung melalui Codex App Server');
  $('#send-note').classList.toggle('hidden',!selectedChat);
  $('#composer').placeholder=selectedChat?'Tulis pesan di chat lama…':'Tulis pesan untuk Codex… (Enter kirim, Shift+Enter baris baru)';
  $('#composer-hint').textContent=selectedChat?'Izin chat ditentukan oleh Codex':'Draft sementara disimpan di memori sesi';
  $('#composer').value=drafts.get(currentTarget)||'';
}
function showTranscript(){
  $('#messages').classList.remove('hidden');$('#catalog').classList.add('hidden');
  renderChatHeader();renderMessages(currentTarget);
}
function renderCatalog(query=''){
  $('#messages').classList.add('hidden');const catalog=$('#catalog');catalog.classList.remove('hidden');catalog.replaceChildren();
  const search=document.createElement('input');search.className='catalog-search';search.placeholder='Cari chat lama…';search.maxLength=120;search.value=query;
  search.addEventListener('input',()=>{clearTimeout(search.timer);search.timer=setTimeout(()=>void loadChats(search.value),250);});catalog.append(search);
  if(chatRows.length===0){const p=document.createElement('p');p.className='mini-status';say(p,'Chat lama belum ditemukan.');catalog.append(p);}
  for(const row of chatRows){
    const button=document.createElement('button');button.className='chat-row';
    const text=document.createElement('span');const title=document.createElement('strong');say(title,row.title||'Chat Codex');
    const meta=document.createElement('small');say(meta,[row.project,row.model].filter(Boolean).join(' · ')||'Percakapan Codex');text.append(title,meta);button.append(text);
    button.addEventListener('click',()=>void openOldChat(row));catalog.append(button);
  }
  if(chatCursor){const more=document.createElement('button');more.className='secondary';more.textContent='Muat chat berikutnya';more.addEventListener('click',()=>void loadChats(query,true));catalog.append(more);}
  const back=document.createElement('button');back.className='secondary';back.textContent='Kembali ke Mini';back.addEventListener('click',showTranscript);catalog.append(back);
}
async function loadChats(query='',more=false){
  $('#mini-status').textContent='Membaca daftar chat…';
  try{
    const result=await window.island.request('list',{query,paged:true,...(more&&chatCursor?{cursor:chatCursor}:{})});
    chatRows=more?[...chatRows,...(result.rows||[])]:result.rows||[];chatCursor=result.nextCursor||null;renderCatalog(query);$('#mini-status').textContent='Chat lama mengikuti izin yang sudah tersimpan di Codex.';
  }catch(error){$('#mini-status').textContent=error.message;}
}
async function openOldChat(row){
  currentTarget=row.id;selectedChat=row;historyCursor=null;conversation(currentTarget).rows=[];renderChatHeader();$('#mini-status').textContent='Memuat percakapan…';
  try{
    const result=await window.island.request('read',{threadId:row.id});
    conversation(currentTarget).load(result.messages||[]);historyCursor=result.nextCursor||null;showTranscript();$('#mini-status').textContent='Chat lama mengikuti izin yang tersimpan di Codex.';
  }catch(error){$('#mini-status').textContent=error.message;renderCatalog();}
}
async function loadHistory(){
  historyLoaded=true;$('#mini-status').textContent='Membuka Mini…';
  try{
    const result=await window.island.request('history');
    currentTarget='mini';selectedChat=null;
    if(result.threadId)conversation('mini').load(result.messages||[]);
    showTranscript();$('#mini-status').textContent='Tersambung ke Codex. Pesan berjalan lewat sesi lokal.';
  }catch(error){historyLoaded=false;$('#mini-status').textContent=error.message;}
}
$('#old-chats').addEventListener('click',()=>void loadChats());
$('#new-chat').addEventListener('click',async()=>{
  if(busy){$('#mini-status').textContent='Tunggu balasan selesai sebelum memulai chat baru.';return;}
  try{await window.island.request('new');selectedChat=null;currentTarget='mini';historyCursor=null;conversation('mini').rows=[];historyLoaded=true;showTranscript();$('#composer').value='';$('#composer').focus();$('#mini-status').textContent='Chat baru siap.';}
  catch(error){$('#mini-status').textContent=error.message;}
});

async function sendMessage(){
  const editor=$('#composer'),text=editor.value;
  if(!text.trim()||busy)return;
  const key=currentTarget;const c=conversation(key);c.begin(text);sendingTarget=key;busy=true;
  renderMessages(key);$('#send').disabled=true;$('#mini-status').textContent='Mengirim pesan…';
  try{
    const params=selectedChat?{text,threadId:selectedChat.id}:{text,cwd:settings.cwd};
    const result=await window.island.request('send',params);
    if(!selectedChat&&result.threadId)settings.miniThreadId=result.threadId;
    if(editor.value===text)editor.value='';drafts.delete(key);$('#mini-status').textContent='Pesan diterima Codex.';
  }catch(error){c.reject();$('#mini-status').textContent=error.message;}
  finally{busy=false;sendingTarget=null;$('#send').disabled=false;renderMessages(key);}
}
$('#send').addEventListener('click',()=>void sendMessage());
$('#stop-turn').addEventListener('click',async()=>{try{await window.island.request('interrupt');}catch(error){$('#mini-status').textContent=error.message;}});
$('#composer').addEventListener('input',event=>{drafts.set(currentTarget,event.target.value);});
$('#composer').addEventListener('keydown',event=>{
  if(event.key==='Enter'&&!event.shiftKey&&(settings.enterToSend||event.ctrlKey)){event.preventDefault();void sendMessage();}
});

async function refreshUsage(){
  const host=$('#usage-cards');host.replaceChildren();$('#usage-updated').textContent='Meminta data dari Codex…';
  try{
    const result=await window.island.request('usage');const windows=usageWindows(result);
    for(const item of windows){
      const card=document.createElement('article');card.className='usage-card';
      const name=document.createElement('small');say(name,`${item.id==='codex'?'Codex':item.id} · ${item.label}`);
      const remaining=document.createElement('strong');say(remaining,item.remaining===null?'Tidak tersedia':`${Math.round(item.remaining)}% tersisa`);
      const track=document.createElement('div');track.className='track';const fill=document.createElement('div');fill.className='fill';fill.style.width=`${item.remaining===null?0:item.remaining}%`;track.append(fill);
      const reset=document.createElement('time');say(reset,item.resetsAt?`Reset ${new Date(item.resetsAt*1000).toLocaleString()}`:'Waktu reset tidak tersedia');card.append(name,remaining,track,reset);host.append(card);
    }
    usageUpdated=Date.now();$('#usage-updated').textContent=`Diperbarui ${new Date(usageUpdated).toLocaleTimeString()} · tanpa polling latar`;
  }catch(error){$('#usage-updated').textContent=error.message;}
}
$('#refresh-usage').addEventListener('click',()=>void refreshUsage());

async function populateSettings(){
  settings=await window.island.getSettings();
  $('#folder-display').textContent=settings.cwd||'—';$('#enter-send').checked=settings.enterToSend!==false;$('#hooks-enabled').checked=settings.hooksEnabled===true;
  $('#version').textContent=await window.island.version();
}
$('#choose-folder').addEventListener('click',async()=>{
  const chosen=await window.island.chooseFolder();if(!chosen)return;
  try{settings=await window.island.saveSettings({cwd:chosen});$('#folder-display').textContent=settings.cwd;$('#mini-status').textContent='Folder kerja diperbarui.';}
  catch(error){$('#mini-status').textContent=error.message;}
});
$('#enter-send').addEventListener('change',async event=>{
  try{settings=await window.island.saveSettings({enterToSend:event.target.checked});$('#composer').placeholder=settings.enterToSend?'Tulis pesan untuk Codex… (Enter kirim, Shift+Enter baris baru)':'Tulis pesan untuk Codex… (Ctrl+Enter kirim)';}
  catch(error){event.target.checked=!event.target.checked;$('#mini-status').textContent=error.message;}
});
$('#hooks-enabled').addEventListener('change',async event=>{
  const enabled=event.target.checked;event.target.disabled=true;
  try{
    await window.island.setHooks(enabled);settings=await window.island.getSettings();$('#mini-status').textContent=enabled?'Hook aktivitas RR-Island diaktifkan.':'Hook RR-Island dihapus; hook aplikasi lain tetap ada.';renderActivity();
  }catch(error){event.target.checked=!enabled;$('#mini-status').textContent=error.message;}
  finally{event.target.disabled=false;}
});

window.island.onEvent(event=>{
  if(event.event==='connection'){setConnection(event.state,event.text);if(event.state==='ready')$('#mini-status').textContent='Tersambung ke Codex.';return;}
  if(event.event==='turn'){
    busy=event.state==='working';$('#stop-turn').classList.toggle('hidden',!busy);$('#send').disabled=busy;
    if(event.state==='working'){petState='working';if(!sendingTarget)sendingTarget=event.threadId==='mini'?'mini':event.threadId;}
    else if(event.state==='finished'){petState='finished';sendingTarget=null;$('#mini-status').textContent='Balasan selesai.';}
    else if(event.state==='cancelled'){petState='idle';sendingTarget=null;$('#mini-status').textContent='Balasan dihentikan.';}
    else if(event.state==='error'){petState='error';sendingTarget=null;$('#mini-status').textContent='Codex gagal menyelesaikan balasan.';}
    renderMessages(currentTarget);renderActivity();return;
  }
  if(event.event==='delta'||event.event==='message'){
    const target=sendingTarget||currentTarget;conversation(target).receive(event);
    if(target===currentTarget)renderMessages(currentTarget);return;
  }
  if(event.event==='notice')$('#mini-status').textContent=event.text;
});
window.island.onStatus(data=>{statusData=data||{sessions:{}};renderActivity();});

$('#refresh-status').addEventListener('click',async()=>{statusData=await window.island.getStatus();renderActivity();});
void populateSettings().then(()=>window.island.getStatus()).then(data=>{statusData=data;renderActivity();}).catch(()=>{});
renderActivity();renderPet();
