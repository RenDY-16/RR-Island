import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class BridgeClient {
    constructor(argv) { this.argv=argv;this.pending=new Map();this.serial=0;this.destroyed=false;this.state='idle';this.onEvent=()=>{}; }
    _start() {
        if (this.destroyed) return Promise.reject(new Error('Island dinonaktifkan.'));
        if (this._ready) return this._ready;
        this.state='connecting';this.onEvent({event:'connection',state:'connecting',text:'Menyambung ke Codex…'});
        this.cancel=new Gio.Cancellable();
        let proc;
        try{proc=Gio.Subprocess.new(this.argv,Gio.SubprocessFlags.STDIN_PIPE|Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_SILENCE);}
        catch{this.state='error';this.onEvent({event:'connection',state:'error',text:'Codex tidak dapat dimulai. Periksa pemasangan aplikasi.'});return Promise.reject(new Error('Codex tidak dapat dimulai.'));}
        this.proc=proc;
        this.input=new Gio.DataInputStream({base_stream:proc.get_stdout_pipe()});
        this.output=proc.get_stdin_pipe();this._writeQueue=Promise.resolve();
        this._ready=new Promise((resolve,reject)=>{this._resolve=resolve;this._reject=reject;});
        this._readyTimer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,30000,()=>{
            this._readyTimer=null;this._fail(proc,'Codex belum siap. Coba lagi.');proc.send_signal(15);return GLib.SOURCE_REMOVE;
        });
        this._read(proc,this.input,this.cancel);
        proc.wait_async(null,(p,r)=>{try{p.wait_finish(r);}catch{}this._fail(proc,'Koneksi berakhir. Klik Kirim atau Perbarui untuk menyambung lagi.');});
        return this._ready;
    }
    _read(proc,input,cancel) {
        input.read_line_async(GLib.PRIORITY_DEFAULT,cancel,(stream,result)=>{
            if (this.destroyed || this.proc!==proc) return;
            try {
                const [line]=stream.read_line_finish_utf8(result);
                if (line===null) {this._fail(proc,'Koneksi Codex terputus.');return;}
                if (line.length>100000) throw new Error('Respons terlalu besar.');
                const event=JSON.parse(line);
                if (event.event==='ready') {
                    if(this._readyTimer)GLib.Source.remove(this._readyTimer);
                    this._readyTimer=null;this._resolve?.();this._resolve=this._reject=null;
                    this.state='ready';this.onEvent({event:'connection',state:'ready',text:'Tersambung ke Codex'});
                } else if (event.event==='connection' && event.state==='idle') {
                    this._fail(proc,event.text||'Istirahat · tersambung lagi saat dipakai.','idle');return;
                } else if (event.event==='connection' && event.state==='error') {
                    this._fail(proc,event.text || 'Koneksi Codex bermasalah.');proc.send_signal(15);return;
                } else if (event.id!==undefined) {
                    const pending=this.pending.get(event.id);
                    if(pending){GLib.Source.remove(pending.timer);this.pending.delete(event.id);
                        event.ok ? pending.resolve(event.data) : pending.reject(new Error(event.error || 'Permintaan gagal.'));}
                }
                if(event.event)this.onEvent(event);
            } catch(e) {this._fail(proc,e.message || 'Respons Codex tidak terbaca.');proc.send_signal(15);return;}
            this._read(proc,input,cancel);
        });
    }
    _fail(proc,message,state='error') {
        if(this.proc!==proc)return;
        if(this._readyTimer)GLib.Source.remove(this._readyTimer);
        this._readyTimer=null;this._reject?.(new Error(message));this._resolve=this._reject=null;
        for(const p of this.pending.values()){GLib.Source.remove(p.timer);p.reject(new Error(message));}
        this.pending.clear();this.proc=null;this._ready=null;this.state=state;this.cancel?.cancel();
        if(!this.destroyed)this.onEvent({event:'connection',state,text:message});
    }
    async request(op,params={}) {
        await this._start();
        if(this.destroyed || !this.proc)throw new Error('Koneksi tidak tersedia.');
        const id=++this.serial;const proc=this.proc;
        const result=new Promise((resolve,reject)=>{
            const timer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,35000,()=>{
                this.pending.delete(id);reject(new Error('Batas waktu permintaan terlewati.'));
                return GLib.SOURCE_REMOVE;
            });
            this.pending.set(id,{resolve,reject,timer});
        });
        const bytes=new TextEncoder().encode(JSON.stringify({id,op,...params})+'\n');
        this._writeQueue=this._writeQueue.then(()=>new Promise((resolve,reject)=>{
            if(this.proc!==proc || this.destroyed){reject(new Error('Koneksi tidak tersedia.'));return;}
            this.output.write_all_async(bytes,GLib.PRIORITY_DEFAULT,this.cancel,(stream,r)=>{
                try{stream.write_all_finish(r);resolve();}catch(e){reject(e);}
            });
        })).catch(()=>{this._fail(proc,'Pesan gagal dikirim ke Codex.');proc.send_signal(15);});
        return result;
    }
    destroy() {
        this.destroyed=true;this.onEvent=()=>{};this.cancel?.cancel();
        const p=this.proc;
        if(p){this._fail(p,'Island dinonaktifkan.');p.send_signal(15);}
    }
}
