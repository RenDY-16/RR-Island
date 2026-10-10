const {app, BrowserWindow, ipcMain, dialog} = require('electron');
const {spawn, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const {pathToFileURL} = require('node:url');
const {updateCodexHooks, makeHookCommand} = require('./hooks.cjs');

app.setName('RR-Island');
let windowRef;
let statusWatcher;
let statusTimer;
const smokeMode=process.argv.includes('--smoke-test');
const stateDir = path.join(app.getPath('userData'), 'state');
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
fs.mkdirSync(stateDir, {recursive:true});

function loadSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    return {
      cwd: typeof value.cwd === 'string' && fs.existsSync(value.cwd) ? value.cwd : os.homedir(),
      enterToSend: value.enterToSend !== false,
      hooksPrompted: value.hooksPrompted === true,
      hooksEnabled: value.hooksEnabled === true,
    };
  } catch { return {cwd:os.homedir(),enterToSend:true,hooksPrompted:false,hooksEnabled:false}; }
}

function saveSettings(next) {
  const current = loadSettings();
  const merged = {...current, ...next};
  const temp = `${settingsFile}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(settingsFile), {recursive:true});
  fs.writeFileSync(temp, JSON.stringify(merged, null, 2), {encoding:'utf8', mode:0o600});
  fs.renameSync(temp, settingsFile);
  return merged;
}

function locateCodex() {
  if (process.env.RR_ISLAND_CODEX_BIN && fs.existsSync(process.env.RR_ISLAND_CODEX_BIN))
    return process.env.RR_ISLAND_CODEX_BIN;
  if (process.platform === 'win32') {
    const found = spawnSync('where.exe', ['codex'], {encoding:'utf8',windowsHide:true,timeout:5000});
    const candidates = (found.stdout || '').split(/\r?\n/).map(s=>s.trim()).filter(Boolean)
      .filter(s=>/\.(exe|cmd|bat)$/i.test(s));
    candidates.sort((a,b)=>Number(/\.exe$/i.test(b))-Number(/\.exe$/i.test(a)));
    return candidates.find(fs.existsSync) || null;
  }
  const found = spawnSync('which', ['codex'], {encoding:'utf8',timeout:5000});
  const candidate = found.status === 0 ? (found.stdout || '').trim() : '';
  if (candidate && fs.existsSync(candidate)) return candidate;
  const appBundled = '/usr/lib/chatgpt/resources/codex';
  return fs.existsSync(appBundled) ? appBundled : null;
}

function helperPath(name) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  if (app.isPackaged) return path.join(process.resourcesPath, 'bin', `${name}${ext}`);
  return null;
}

class BridgeHost {
  constructor() { this.proc=null;this.pending=new Map();this.serial=0;this.ready=null;this.starting=null; }
  event(event) {
    if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send('island:event', event);
  }
  start() {
    if (this.proc && this.ready) return this.ready;
    if (this.starting) return this.starting;
    const codex = locateCodex();
    if (!codex) {
      const error = new Error('Codex CLI tidak ditemukan. Install Codex CLI lalu buka ulang RR-Island.');
      this.event({event:'connection',state:'error',text:error.message});
      return Promise.reject(error);
    }
    let executable, args;
    const packagedBridge = helperPath('rr-island-bridge');
    if (app.isPackaged) {
      if (!fs.existsSync(packagedBridge)) {
        const error = new Error('Bridge RR-Island tidak tersedia di paket ini. Pasang ulang aplikasi.');
        this.event({event:'connection',state:'error',text:error.message});
        return Promise.reject(error);
      }
      executable = packagedBridge;
      args = ['--codex-binary',codex,'--state-dir',stateDir,'--cwd',loadSettings().cwd];
    } else {
      executable = process.platform === 'win32' ? 'python' : 'python3';
      args = [path.join(__dirname,'..','bridge.py'),'--codex-binary',codex,'--state-dir',stateDir,'--cwd',loadSettings().cwd];
    }
    this.event({event:'connection',state:'connecting',text:'Menyambung ke Codex…'});
    this.proc = spawn(executable,args,{stdio:['pipe','pipe','ignore'],windowsHide:true});
    const proc = this.proc;
    const lines = readline.createInterface({input:proc.stdout,crlfDelay:Infinity});
    this.starting = new Promise((resolve,reject)=>{
      const timer = setTimeout(()=>{reject(new Error('Codex belum siap. Periksa login Codex lalu coba sambungkan lagi.'));proc.kill();},30000);
      this.ready = new Promise((readyResolve,readyReject)=>{this.resolveReady=readyResolve;this.rejectReady=readyReject;});
      lines.on('line',line=>{
        if (line.length>4*1024*1024) { proc.kill(); return; }
        let message;try{message=JSON.parse(line);}catch{return;}
        if (message.event === 'ready') {
          clearTimeout(timer);this.resolveReady?.();this.resolveReady=null;this.rejectReady=null;
          this.event({event:'connection',state:'ready',text:'Tersambung ke Codex'});return;
        }
        if (message.id !== undefined) {
          const pending=this.pending.get(String(message.id));
          if(pending){clearTimeout(pending.timer);this.pending.delete(String(message.id));
            message.ok?pending.resolve(message.data):pending.reject(new Error(message.error||'Permintaan gagal.'));}
        }
        if(message.event)this.event(message);
      });
      proc.once('error',error=>{clearTimeout(timer);reject(new Error(`Bridge RR-Island gagal dijalankan: ${error.message}`));});
      proc.once('exit',(code)=>{
        clearTimeout(timer);
        if (this.proc !== proc) return;
        this.proc=null;this.ready=null;this.starting=null;
        const error=new Error('Koneksi Codex terputus. Klik Sambungkan untuk mencoba lagi.');
        this.rejectReady?.(error);this.rejectReady=null;this.resolveReady=null;
        for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error);}
        this.pending.clear();
        this.event({event:'connection',state:'error',text:code===0?error.message:`${error.message} (exit ${code ?? 'unknown'})`});
      });
      this.ready.then(()=>{this.starting=null;resolve();},error=>{this.starting=null;reject(error);});
    });
    return this.starting;
  }
  async request(op, params={}) {
    if (!['connect','new','usage','list','read','history','send','interrupt'].includes(op)) throw new Error('Operasi tidak diizinkan.');
    await this.start();
    const id=String(++this.serial),proc=this.proc;
    const result=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Batas waktu RR-Island terlewati.'));},40000);
      this.pending.set(id,{resolve,reject,timer});
    });
    try { proc.stdin.write(JSON.stringify({id,op,...params})+'\n'); }
    catch { const pending=this.pending.get(id);if(pending){clearTimeout(pending.timer);this.pending.delete(id);pending.reject(new Error('Pesan gagal diteruskan ke Codex.'));} }
    return result;
  }
  stop() {
    const proc=this.proc;if(!proc)return;
    try{proc.stdin.write('{"op":"shutdown"}\n');}catch{}
    const timer=setTimeout(()=>{if(!proc.killed)proc.kill();},1500);timer.unref();
    this.proc=null;this.ready=null;this.starting=null;
    for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('Koneksi diperbarui.'));}
    this.pending.clear();
  }
}
const bridge = new BridgeHost();

function readStatus() {
  try { return JSON.parse(fs.readFileSync(path.join(stateDir,'status.json'),'utf8')); }
  catch { return {version:1,sessions:{}}; }
}
function publishStatus() { if(windowRef&&!windowRef.isDestroyed())windowRef.webContents.send('island:status',readStatus()); }
function watchStatus() {
  if(statusWatcher)statusWatcher.close();
  try { statusWatcher=fs.watch(stateDir,(_event,name)=>{if(!name||String(name)==='status.json'){clearTimeout(statusTimer);statusTimer=setTimeout(publishStatus,80);}}); }
  catch {}
}

function getHookHelper() {
  const packaged = helperPath('rr-island-hook');
  if (app.isPackaged) {
    const target=path.join(app.getPath('userData'),'bin',app.getVersion(),path.basename(packaged));
    if (!fs.existsSync(packaged)) throw new Error('Helper activity status tidak ada dalam paket aplikasi.');
    fs.mkdirSync(path.dirname(target),{recursive:true});
    if (!fs.existsSync(target) || fs.statSync(target).size!==fs.statSync(packaged).size) fs.copyFileSync(packaged,target);
    return target;
  }
  return null;
}

function setActivityHooks(enabled) {
  let executable, extraArgs=[];
  if (app.isPackaged) executable=enabled?getHookHelper():path.join(app.getPath('userData'),'bin',app.getVersion(),`rr-island-hook${process.platform==='win32'?'.exe':''}`);
  else {
    const python=process.platform==='win32'?'python':'python3';
    const script=path.join(__dirname,'..','hook.py');
    executable=python;extraArgs=[script];
  }
  const hooksFile=path.join(os.homedir(),'.codex','hooks.json');
  const result=updateCodexHooks({hooksFile,executable,stateDir,enabled,command:makeHookCommand(executable,stateDir,process.platform,extraArgs)});
  saveSettings({hooksEnabled:enabled,hooksPrompted:true});
  return result;
}

function createWindow() {
  const indexFile=path.join(__dirname,'index.html');
  const trustedUrl=pathToFileURL(indexFile).href;
  windowRef = new BrowserWindow({
    width:1180,height:790,minWidth:840,minHeight:620,show:!smokeMode,
    backgroundColor:'#08090d',title:'RR-Island',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true},
  });
  windowRef.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  windowRef.webContents.on('will-navigate',(event,url)=>{if(url!==trustedUrl)event.preventDefault();});
  if(smokeMode)windowRef.webContents.on('console-message',(_event,level,message)=>{if(level>=2){console.error(message);process.exitCode=1;}});
  windowRef.loadURL(trustedUrl);
  if(smokeMode)windowRef.webContents.once('did-finish-load',()=>setTimeout(async()=>{
    try{
      const ready=await windowRef.webContents.executeJavaScript("Boolean(window.island && document.querySelector('#page-title')?.textContent === 'Aktivitas')");
      if(!ready)throw new Error('Renderer or preload did not initialize.');
      console.log('RR_ISLAND_SMOKE_OK');
    }catch(error){console.error(error.message);process.exitCode=1;}
    app.quit();
  },250));
  windowRef.on('closed',()=>{windowRef=null;});
  watchStatus();
  if(!smokeMode)void bridge.start().catch(()=>{});
  return windowRef;
}

function handleIpc(channel, handler) {
  ipcMain.handle(channel,(event,...args)=>{
    if(!windowRef||event.sender!==windowRef.webContents||event.senderFrame?.url!==pathToFileURL(path.join(__dirname,'index.html')).href)
      throw new Error('Permintaan dari window yang tidak dipercaya ditolak.');
    return handler(...args);
  });
}
handleIpc('bridge:request',(op,params)=>bridge.request(op,params));
handleIpc('settings:get',()=>loadSettings());
handleIpc('settings:set',(next)=>{
  if(!next||typeof next!=='object'||Array.isArray(next)||Object.keys(next).some(key=>!['cwd','enterToSend'].includes(key)))
    throw new Error('Pengaturan tidak valid.');
  if(next.enterToSend!==undefined&&typeof next.enterToSend!=='boolean')throw new Error('Preferensi Enter harus bernilai ya atau tidak.');
  if(next?.cwd!==undefined&&(typeof next.cwd!=='string'||!fs.existsSync(next.cwd)||!fs.statSync(next.cwd).isDirectory()))
    throw new Error('Pilih folder kerja yang tersedia.');
  const settings=saveSettings(next||{});
  if(bridge.proc){bridge.stop();void bridge.start().catch(()=>{});}
  return settings;
});
handleIpc('status:get',()=>readStatus());
handleIpc('hooks:set',async(enabled)=>{
  if(typeof enabled!=='boolean')throw new Error('Pilihan hook tidak valid.');
  try{return setActivityHooks(enabled);}
  catch(error){throw new Error(error.message||'Pengaturan hook gagal diperbarui.');}
});
handleIpc('folder:choose',async()=>{
  const result=await dialog.showOpenDialog(windowRef,{properties:['openDirectory','createDirectory']});
  return result.canceled?null:result.filePaths[0];
});
handleIpc('app:version',()=>app.getVersion());

app.whenReady().then(async()=>{
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
  if(smokeMode)return;
  const settings=loadSettings();
  if(!settings.hooksPrompted){
    const result=await dialog.showMessageBox(windowRef,{type:'question',title:'Pantau aktivitas Codex?',
      message:'RR-Island dapat menampilkan status sesi Codex dengan hook lokal.',
      detail:'Hook hanya menyimpan status, nama proyek, dan nama tool. Isi prompt serta jawaban tidak disimpan. RR-Island akan menambah entri miliknya sendiri ke hooks.json dan membuat backup sebelum perubahan.',
      buttons:['Aktifkan','Nanti'],defaultId:0,cancelId:1});
    saveSettings({hooksPrompted:true});
    if(result.response===0){try{setActivityHooks(true);}catch(error){dialog.showErrorBox('Hook belum diaktifkan',error.message);}}
  }
});
app.on('before-quit',()=>{if(statusWatcher)statusWatcher.close();clearTimeout(statusTimer);bridge.stop();});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
