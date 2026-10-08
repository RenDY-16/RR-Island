#!/usr/bin/python3
"""On-demand Codex App Server client: local JSON-lines pipes, no listener/logs."""
import argparse,json,os,shutil,subprocess,sys,threading,time,selectors,tempfile,fcntl,signal
from pathlib import Path
class BridgeError(Exception):pass
class RPCTimeout(BridgeError):pass
def safe_id(v):return isinstance(v,str) and 0<len(v)<=160 and all(c.isalnum() or c in '-_' for c in v)
class RPC:
 def __init__(self,binary,timeout,on_event):
  self.timeout=timeout;self.on_event=on_event;self.pending={};self.lock=threading.Lock();self.write_lock=threading.Lock();self.serial=0;self.closed=False
  self.p=subprocess.Popen([binary,'app-server','--stdio'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True)
  self.reader=threading.Thread(target=self._read,daemon=True);self.reader.start()
 def write(self,obj):
  with self.write_lock:
   if self.closed:raise BridgeError('Koneksi Codex terputus.')
   try:self.p.stdin.write((json.dumps(obj)+'\n').encode());self.p.stdin.flush()
   except (BrokenPipeError,OSError):raise BridgeError('Koneksi Codex terputus.') from None
 def call(self,method,params=None,timeout=None):
  event=threading.Event();box={}
  with self.lock:self.serial+=1;i=self.serial;self.pending[i]=(event,box)
  try:
   self.write({'id':i,'method':method,**({'params':params} if params is not None else {})})
   if not event.wait(self.timeout if timeout is None else timeout):raise RPCTimeout('Batas waktu koneksi Codex terlewati. Periksa balasan atau hentikan dahulu.')
   if 'error' in box:
    if box['error']=='eof':raise BridgeError('Koneksi Codex terputus.')
    raw=str(box['error']).lower()
    if 'active writer' in raw or 'live local writer' in raw:raise BridgeError('Chat ini sedang dipakai aplikasi Codex. Lanjutkan dari aplikasi utama atau tutup chat tersebut dahulu; draft tetap tersimpan.')
    if any(x in raw for x in ['unauthorized','auth','login']):raise BridgeError('Login Codex diperlukan. Buka aplikasi Codex dahulu.')
    if any(x in raw for x in ['rate','limit','usage']):raise BridgeError('Batas penggunaan Codex tercapai. Periksa Usage.')
    raise BridgeError('Permintaan Codex gagal; coba lagi atau buka aplikasi utama.')
   return box.get('result',{})
  finally:
   with self.lock:self.pending.pop(i,None)
 def _read(self):
  try:
   while True:
    line=self.p.stdout.readline(4*1024*1024+1)
    if not line or len(line)>4*1024*1024:break
    try:d=json.loads(line)
    except (ValueError,UnicodeError):continue
    if 'method' in d:
     if 'id' in d:
      if d['method'] in ['item/commandExecution/requestApproval','item/fileChange/requestApproval']:self.write({'id':d['id'],'result':{'decision':'decline'}})
      else:self.write({'id':d['id'],'error':{'code':-32601,'message':'Unsupported in Island Mini'}})
      self.on_event('approval',{})
     else:self.on_event(d['method'],d.get('params') or {})
     continue
    with self.lock:
     pair=self.pending.get(d.get('id'))
     if pair:pair[1].update(d);pair[0].set()
  except (OSError,ValueError,BridgeError):pass
  finally:
   self.closed=True
   with self.lock:
    for event,box in self.pending.values():box['error']='eof';event.set()
   self.on_event('disconnected',{})
 def close(self):
  self.closed=True
  if self.p.poll() is None:
   os.killpg(self.p.pid,signal.SIGTERM)
   try:self.p.wait(timeout=3)
   except subprocess.TimeoutExpired:os.killpg(self.p.pid,signal.SIGKILL);self.p.wait()
  self.reader.join(timeout=1);self.p.stdin.close();self.p.stdout.close()
class Bridge:
 def __init__(self,binary,state_dir,cwd,timeout=25,emit=None):
  self.binary=binary;self.timeout=timeout;self.output_lock=threading.Lock();self.emit=emit or self._emit
  self.state_dir=Path(state_dir);self.state_dir.mkdir(parents=True,exist_ok=True,mode=0o700)
  self.lease=open(self.state_dir/'mini.lock','a');os.chmod(self.state_dir/'mini.lock',0o600)
  try:fcntl.flock(self.lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:self.lease.close();raise BridgeError('Mini sedang dipakai proses Island lain.') from None
  self.state=self.state_dir/'mini.json';self.cwd=cwd;self.thread_id=None;self.loaded=False;self.busy=False;self.turn_id=None;self.lock=threading.RLock();self.closing=False;self.rpc=None;self.active_thread_id=None;self.active_rpc=None;self.external_token=None;self.external_rpc=None;self.start_settled=None;self.finishing=False;self.finish_worker=None
  try:
   if self.state.exists():
    try:
     d=json.loads(self.state.read_text());i=d.get('threadId') if isinstance(d,dict) else None
     if safe_id(i):self.thread_id=i
    except (ValueError,OSError):pass
   self.rpc=RPC(binary,timeout,self.on_event)
   self.rpc.call('initialize',{'clientInfo':{'name':'codex_island','title':'Codex Island','version':'0.3.0'}})
   self.rpc.write({'method':'initialized','params':{}})
  except Exception:
   if self.rpc:self.rpc.close()
   self.lease.close();raise
 def _emit(self,obj):
  with self.output_lock:print(json.dumps(obj,ensure_ascii=False),flush=True)
 def save(self):
  fd,p=tempfile.mkstemp(prefix='.mini-',dir=self.state_dir)
  try:
   with os.fdopen(fd,'w') as f:json.dump({'threadId':self.thread_id},f)
   os.replace(p,self.state)
  finally:
   if os.path.exists(p):os.unlink(p)
 def external_event(self,token,method,p):
  if token is self.external_token:self.on_event(method,p,external=True)
 def release_external(self):
  with self.lock:
   rpc=self.external_rpc;self.external_token=None;self.external_rpc=None
  if rpc:rpc.close()
 def finish_external(self,state,i):
  # Reader callbacks must neither join themselves nor close a still-pending
  # turn/start response. Keep the guard until acceptance settles and child exits.
  with self.lock:
   if self.finishing:return
   self.finishing=True;token=self.external_token;settled=self.start_settled
  def finish():
   if settled:settled.wait(self.timeout+1)
   if token is not self.external_token:return
   self.release_external()
   with self.lock:
    self.busy=False;self.turn_id=None;self.active_thread_id=None;self.active_rpc=None;self.finishing=False
   if not self.closing:self.emit({'event':'turn','state':state,'threadId':i})
  self.finish_worker=threading.Thread(target=finish,daemon=True);self.finish_worker.start()
 def on_event(self,method,p,external=False):
  if self.closing:return
  i=self.active_thread_id or self.thread_id
  if method=='disconnected':
   if external:
    self.finish_external('error',i)
   elif self.external_rpc or self.finishing or (self.active_rpc is not None and self.active_rpc is not self.rpc):
    self.emit({'event':'notice','text':'Koneksi riwayat terputus; balasan chat lama tetap berjalan.'})
   else:
    with self.lock:self.busy=False;self.turn_id=None
    self.emit({'event':'connection','state':'error','text':'Koneksi Codex terputus.'})
   return
  if method=='approval':self.emit({'event':'notice','text':'Persetujuan tool ini belum didukung Mini; permintaan ditolak.'});return
  if p.get('threadId')!=i:return
  if method=='turn/started':
   with self.lock:self.turn_id=p.get('turn',{}).get('id');self.busy=True
   self.emit({'event':'turn','state':'working','threadId':i})
  elif method=='item/agentMessage/delta':self.emit({'event':'delta','threadId':i,'itemId':p.get('itemId','message'),'text':str(p.get('delta',''))[:16000]})
  elif method=='item/completed' and p.get('item',{}).get('type')=='agentMessage':
   item=p['item'];text=str(item.get('text',''));self.emit({'event':'message','threadId':i,'itemId':item.get('id','message'),'text':text[:16000],'truncated':len(text)>16000})
  elif method=='turn/completed':
   status=p.get('turn',{}).get('status');state={'completed':'finished','interrupted':'cancelled'}.get(status,'error')
   if external:self.finish_external(state,i)
   else:
    with self.lock:self.busy=False;self.turn_id=None;self.active_thread_id=None;self.active_rpc=None
    self.emit({'event':'turn','state':state,'threadId':i})
 def owned_thread(self,cwd):
  if self.loaded:return self.thread_id
  cfg={'cwd':cwd,'sandbox':'read-only','approvalPolicy':'never'}
  r=self.rpc.call('thread/resume',{'threadId':self.thread_id,**cfg}) if self.thread_id else self.rpc.call('thread/start',{**cfg,'serviceName':'codex-island'})
  i=r.get('thread',{}).get('id')
  if not safe_id(i):raise BridgeError('ID chat Mini tidak valid.')
  self.thread_id=i;self.loaded=True;self.save();return i
 @staticmethod
 def transcript(thread):
  messages=[]
  for turn in thread.get('turns',[])[-8:]:
   for index,item in enumerate(turn.get('items',[])):
    item_id=item.get('id') or f"{turn.get('id','turn')}-{index}"
    if item.get('type')=='agentMessage':messages.append({'id':item_id,'role':'Codex','text':str(item.get('text',''))})
    elif item.get('type')=='userMessage':
     text='\n'.join(str(c.get('text','')) for c in item.get('content',[]) if c.get('type')=='text');messages.append({'id':item_id,'role':'Kamu','text':text})
  # Keep every display item covered by the cursor. Bound text, never silently
  # drop messages from a page; the UI identifies these as previews.
  limit=min(4000,max(1,30000//max(1,len(messages))))
  for message in messages:
   text=message['text'];message['truncated']=len(text)>limit;message['text']=text[:limit]
  return messages
 @staticmethod
 def chat_row(s):
  return {'id':s['id'],'title':str(s.get('name') or s.get('preview') or 'Chat Codex')[:80],'project':Path(s.get('cwd') or '').name[:80],'model':s.get('model')}
 def dispatch(self,d):
  op=d.get('op')
  cursor=d.get('cursor')
  if cursor is not None and (not isinstance(cursor,str) or not cursor or len(cursor)>4096):raise BridgeError('Cursor chat tidak valid.')
  if op=='connect':
   if self.rpc.closed:raise BridgeError('Koneksi Codex terputus.')
   return {'threadId':self.thread_id}
  if op=='usage':
   r=self.rpc.call('account/rateLimits/read');return {k:r.get(k) for k in ['rateLimits','rateLimitsByLimitId']}
  if op=='list':
   query=d.get('query','');pins=d.get('pins',[])
   if not isinstance(query,str) or len(query)>120:raise BridgeError('Pencarian maksimal 120 karakter.')
   if not isinstance(pins,list) or len(pins)>12 or not all(safe_id(i) for i in pins):raise BridgeError('Daftar pin tidak valid.')
   params={'limit':12,'archived':False,'sortKey':'updated_at'}
   if query.strip():params['searchTerm']=query.strip()
   if cursor:params['cursor']=cursor
   r=self.rpc.call('thread/list',params)
   rows=[self.chat_row(s) for s in r.get('data',[]) if safe_id(s.get('id'))]
   if not cursor and not query:
    present={s['id'] for s in rows}
    for i in pins:
     if i in present:continue
     try:
      s=self.rpc.call('thread/read',{'threadId':i,'includeTurns':False}).get('thread',{})
      if safe_id(s.get('id')):rows.insert(0,self.chat_row(s));present.add(s['id'])
     except BridgeError:continue
   return {'rows':rows,'nextCursor':r.get('nextCursor')} if d.get('paged') is True else rows
  if op in ['read','history']:
   i=self.thread_id if op=='history' else d.get('threadId')
   if not i:return {'threadId':None,'messages':[],'nextCursor':None}
   if not safe_id(i):raise BridgeError('ID chat tidak valid.')
   # Old chats may contain megabytes of tool output. The protocol's summary
   # pages return only display messages, never a full-history hydration.
   params={'threadId':i,'limit':8,'sortDirection':'desc','itemsView':'summary'}
   if cursor:params['cursor']=cursor
   r=self.rpc.call('thread/turns/list',params)
   return {'threadId':i,'messages':self.transcript({'turns':list(reversed(r.get('data',[])))}),'nextCursor':r.get('nextCursor')}
  if op=='send':
   text=d.get('text');target=d.get('threadId');cwd=d.get('cwd') or self.cwd
   if not isinstance(text,str) or not text.strip() or len(text)>8000:raise BridgeError('Isi pesan 1–8000 karakter diperlukan.')
   if target is not None and not safe_id(target):raise BridgeError('ID chat tidak valid.')
   external=target is not None and target!=self.thread_id
   if not external and (not isinstance(cwd,str) or not Path(cwd).is_dir()):raise BridgeError('Folder kerja tidak tersedia; periksa Pengaturan.')
   with self.lock:
    if self.closing:raise BridgeError('Island sedang ditutup; pesan belum dikirim.')
    if self.busy or self.finishing:raise BridgeError('Mini masih menjawab. Tunggu atau hentikan balasannya.')
    self.busy=True;self.start_settled=threading.Event();self.finishing=False
   settled=self.start_settled;rpc=self.rpc
   try:
    if external:
     # Popen + publication share the shutdown lock. main() may exit while
     # daemon workers run, so shutdown must know every spawned child immediately.
     with self.lock:
      if self.closing:raise BridgeError('Island sedang ditutup; pesan belum dikirim.')
      token=object();self.external_token=token
      rpc=RPC(self.binary,self.timeout,lambda m,p:self.external_event(token,m,p));self.external_rpc=rpc
     rpc.call('initialize',{'clientInfo':{'name':'codex_island','title':'Codex Island','version':'0.8.0'}})
     rpc.write({'method':'initialized','params':{}})
     resumed=rpc.call('thread/resume',{'threadId':target,'excludeTurns':True})
     thread=resumed.get('thread',{})
     if thread.get('id')!=target:raise BridgeError('Tujuan chat tidak cocok. Pesan belum dikirim.')
     status=thread.get('status',{}).get('type')
     if status!='idle':raise BridgeError('Chat ini masih menjawab atau belum siap. Lanjutkan di aplikasi utama; draft tetap tersimpan.')
     i=target;params={'threadId':i,'input':[{'type':'text','text':text}]}
    else:
     i=self.owned_thread(cwd);params={'threadId':i,'input':[{'type':'text','text':text}],'cwd':cwd}
    with self.lock:
     if self.closing:raise BridgeError('Island sedang ditutup; pesan belum dikirim.')
     self.active_thread_id=i;self.active_rpc=rpc
    r=rpc.call('turn/start',params)
    with self.lock:
     if self.busy and not self.finishing:self.turn_id=r.get('turn',{}).get('id')
    return {'threadId':i}
   except RPCTimeout:
    with self.lock:active=self.turn_id is not None
    if external and active:
     self.emit({'event':'notice','text':'Pesan sudah diterima Codex; konfirmasi koneksi terlambat. Tunggu balasan atau klik Hentikan.'})
     return {'threadId':self.active_thread_id,'acceptedViaNotification':True}
    if not active and not self.finishing:
     if external:self.release_external()
     else:rpc.close()
     with self.lock:self.busy=False;self.active_thread_id=None;self.active_rpc=None
    raise
   except Exception:
    with self.lock:active=self.turn_id is not None
    if not active and not self.finishing:
     if external:self.release_external()
     with self.lock:self.busy=False;self.active_thread_id=None;self.active_rpc=None
    raise
   finally:settled.set()
  if op=='interrupt':
   with self.lock:i,t,rpc=self.active_thread_id,self.turn_id,self.active_rpc
   if not t:return {'interrupted':False}
   rpc.call('turn/interrupt',{'threadId':i,'turnId':t},timeout=5);return {'interrupted':True}
  raise BridgeError('Operasi Mini tidak dikenal.')
 def respond(self,d):
  try:self.emit({'id':d.get('id'),'ok':True,'data':self.dispatch(d)})
  except BridgeError as e:self.emit({'id':d.get('id'),'ok':False,'error':str(e)})
  except Exception:self.emit({'id':d.get('id'),'ok':False,'error':'Permintaan Mini tidak valid atau koneksi bermasalah.'})
 def close(self):
  with self.lock:self.closing=True
  try:
   if self.turn_id and self.active_rpc:self.active_rpc.call('turn/interrupt',{'threadId':self.active_thread_id,'turnId':self.turn_id},timeout=2)
  except BridgeError:pass
  self.start_settled and self.start_settled.set()
  self.release_external()
  if self.finish_worker and self.finish_worker is not threading.current_thread():self.finish_worker.join(timeout=4)
  self.rpc.close();self.lease.close()
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--codex-binary',default='/usr/lib/chatgpt/resources/codex' if Path('/usr/lib/chatgpt/resources/codex').exists() else shutil.which('codex'))
 parser.add_argument('--state-dir',default=str(Path(os.environ.get('XDG_STATE_HOME',Path.home()/'.local/state'))/'codex-island'))
 parser.add_argument('--cwd',default=str(Path.home()));parser.add_argument('--timeout',type=float,default=25)
 parser.add_argument('--idle-seconds',type=float,default=300)
 args=parser.parse_args();bridge=None
 signal.signal(signal.SIGTERM,lambda *_:sys.exit(0))
 try:
  if not args.codex_binary:raise BridgeError('Binary Codex tidak ditemukan. Buka/install aplikasi Codex.')
  bridge=Bridge(args.codex_binary,args.state_dir,args.cwd,args.timeout);bridge.emit({'event':'ready','threadId':bridge.thread_id})
  selector=selectors.DefaultSelector();selector.register(sys.stdin,selectors.EVENT_READ);buf=b'';last=time.monotonic();workers=[]
  while True:
   if time.monotonic()-last>args.idle_seconds and not bridge.busy and not any(w.is_alive() for w in workers):
    bridge.close()
    bridge.emit({'event':'connection','state':'idle','text':'Istirahat · tersambung lagi saat dipakai.'})
    bridge=None;break
   if not selector.select(1):continue
   data=os.read(sys.stdin.fileno(),4096)
   if not data:break
   buf+=data
   if len(buf)>65536:bridge.emit({'event':'notice','text':'Permintaan terlalu panjang.'});break
   while b'\n' in buf:
    line,buf=buf.split(b'\n',1);last=time.monotonic()
    try:d=json.loads(line)
    except (ValueError,UnicodeError):bridge.emit({'event':'notice','text':'Permintaan JSON tidak valid.'});continue
    if not isinstance(d,dict):continue
    if d.get('op')=='shutdown':return 0
    workers=[w for w in workers if w.is_alive()]
    if len(workers)>=4:bridge.emit({'id':d.get('id'),'ok':False,'error':'Terlalu banyak permintaan; tunggu sebentar.'});continue
    w=threading.Thread(target=bridge.respond,args=(d,),daemon=True);workers.append(w);w.start()
  selector.close()
 except (BridgeError,OSError) as e:
  text=str(e) if isinstance(e,BridgeError) else 'Codex tidak dapat dimulai.';print(json.dumps({'event':'connection','state':'error','text':text}),flush=True);return 1
 finally:
  if bridge:bridge.close()
 return 0
if __name__=='__main__':sys.exit(main())
