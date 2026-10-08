import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {usageWindows} from './model.js';

export class UsagePane {
    constructor(client) {
        this.client=client;this.loadedAt=0;this.dead=false;
        this.actor=new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL,style_class:'ci-pane'});
        this.rows=new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL});
        this.actor.add_child(this.rows);
        this.info=new St.Label({text:'Usage diperbarui saat dibuka.',style_class:'ci-subtitle'});this.actor.add_child(this.info);
        this.refresh=new St.Button({label:'Perbarui',style_class:'ci-action',can_focus:true,x_align:Clutter.ActorAlign.START});
        this.refresh.connect('clicked',()=>this.open(true));this.actor.add_child(this.refresh);
    }
    async open(force=false) {
        if(this.loading||(!force&&Date.now()-this.loadedAt<60000))return;
        this.loading=true;this.info.text='Membaca batas penggunaan akun…';this.refresh.reactive=false;
        try{
            const data=await this.client.request('usage');if(this.dead)return;
            this.windows=usageWindows(data);
            for(const c of this.rows.get_children())c.destroy();
            for(const w of this.windows){
                const box=new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL,style_class:'ci-usage-card'});
                box.add_child(new St.Label({text:`${w.id==='codex'?'Codex':w.id} · ${w.label}`,style_class:'ci-subtitle'}));
                box.add_child(new St.Label({text:w.remaining===null?'Tidak tersedia':`${Math.round(w.remaining)}% tersisa`,style_class:'ci-quota'}));
                const track=new St.BoxLayout({style_class:'ci-track',width:348,height:6});
                if(w.remaining!==null)track.add_child(new St.Widget({style_class:'ci-fill',width:348*w.remaining/100,height:6}));
                box.add_child(track);
                const date=w.resetsAt?GLib.DateTime.new_from_unix_local(w.resetsAt):null;
                box.add_child(new St.Label({text:date?`Reset ${date.format('%a %d %b, %H:%M')}${w.resetsAt<Date.now()/1000?' · perbarui data':''}`:'Waktu reset tidak tersedia',style_class:'ci-meta'}));
                this.rows.add_child(box);
            }
            this.loadedAt=Date.now();this.info.text=`Diperbarui ${GLib.DateTime.new_now_local().format('%H:%M:%S')} · tanpa polling latar`;
        }catch(e){if(!this.dead)this.info.text=e.message;}
        finally{if(!this.dead){this.loading=false;this.refresh.reactive=true;}}
    }
    destroy(){this.dead=true;}
}
