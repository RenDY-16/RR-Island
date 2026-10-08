import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Gio from 'gi://Gio';
import {ChatSessions,shouldSubmit,chatRows,prependPage} from './mini-model.js';

function button(label,action){const b=new St.Button({label,style_class:'ci-action',can_focus:true});b.connect('clicked',action);return b;}
function focusInput(entry){
    // Multiline St.Entry padding can be clicked without focusing its ClutterText.
    // Transfer focus for the whole field while retaining normal caret gestures.
    entry.connect('captured-event',(_actor,event)=>{
        if(event.type()===Clutter.EventType.TOUCH_BEGIN||
            (event.type()===Clutter.EventType.BUTTON_PRESS&&event.get_button()===Clutter.BUTTON_PRIMARY))
            entry.clutter_text.grab_key_focus();
        return Clutter.EVENT_PROPAGATE;
    });
}
function textLabel(text,style){
    const l=new St.Label({text,style_class:style,x_expand:true});
    l.clutter_text.line_wrap=true;l.clutter_text.line_wrap_mode=Pango.WrapMode.WORD_CHAR;
    l.clutter_text.ellipsize=Pango.EllipsizeMode.NONE;return l;
}
export class MiniPane {
    constructor(client,settings){
        this.client=client;this.settings=settings;this.chats=new ChatSessions();this.conversation=this.chats.get('mini');this.sendingKey=null;
        this.busy=false;this.waiting=false;this.historyLoading=false;this.dead=false;this.preview=false;this.viewVersion=0;
        this.replyTarget=null;this.replyState='working';
        this.connectionState='idle';this.catalog=[];this.previewMessages=[];this.bubbles=new Map();
        this.actor=new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL,style_class:'ci-pane'});
        this.notice=new St.Label({text:'Chat khusus Island',style_class:'ci-subtitle'});this.actor.add_child(this.notice);
        const connection=new St.BoxLayout({style_class:'ci-controls'});
        this.connection=new St.Label({text:'Belum tersambung',style_class:'ci-connection',x_expand:true,y_align:Clutter.ActorAlign.CENTER});
        this.reconnectButton=button('Sambungkan',()=>this.reconnect());
        connection.add_child(this.connection);connection.add_child(this.reconnectButton);this.actor.add_child(connection);
        this.search=new St.Entry({hint_text:'Cari judul chat…',style_class:'ci-entry',can_focus:true,x_expand:true});
        focusInput(this.search);
        this.search.clutter_text.set_max_length(120);this.search.visible=false;
        this.search.clutter_text.connect('text-changed',()=>{
            if(this._searchTimer)GLib.Source.remove(this._searchTimer);
            ++this.viewVersion;
            if(this.previewMode!=='catalog')return;
            this._renderCatalog();
            this._searchTimer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,350,()=>{
                this._searchTimer=null;if(!this.dead&&this.previewMode==='catalog')void this._loadChats(false);return GLib.SOURCE_REMOVE;
            });
        });this.actor.add_child(this.search);
        this.scroll=new St.ScrollView({style_class:'ci-chat-scroll',overlay_scrollbars:true});
        this.body=new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL,style_class:'ci-chat-body'});
        this.scroll.set_child(this.body);this.actor.add_child(this.scroll);
        this.latestButton=button('Ke pesan terbaru ↓',()=>this.jumpLatest());this.latestButton.visible=false;this.actor.add_child(this.latestButton);
        this.replyButton=button('',()=>this.returnToReply());this.replyButton.visible=false;this.actor.add_child(this.replyButton);
        const adjustment=this._adjustment();
        this._adjustmentSignals=adjustment?['notify::value','notify::upper','notify::page-size'].map(signal=>adjustment.connect(signal,()=>{if(!this.dead)this._updateLatest();})):[];
        this.entry=new St.Entry({hint_text:'Pesan untuk Codex…',style_class:'ci-entry ci-composer',can_focus:true,x_expand:true});
        focusInput(this.entry);
        this.entry.clutter_text.set_max_length(8000);this.entry.clutter_text.single_line_mode=false;this.entry.clutter_text.activatable=false;
        this.entry.clutter_text.connect('activate',()=>this.send());
        this.entry.clutter_text.connect('key-press-event',(_t,e)=>{
            if([Clutter.KEY_Return,Clutter.KEY_KP_Enter].includes(e.get_key_symbol())&&shouldSubmit(this.settings.get_boolean('enter-to-send'),Boolean(e.get_state()&Clutter.ModifierType.SHIFT_MASK),Boolean(e.get_state()&Clutter.ModifierType.CONTROL_MASK))){
                void this.send();return Clutter.EVENT_STOP;
            }return Clutter.EVENT_PROPAGATE;
        });this.actor.add_child(this.entry);
        const controls=new St.BoxLayout({style_class:'ci-controls'});
        this.sendButton=button('Kirim',()=>this.send());this.stopButton=button('Hentikan',()=>this.stop());
        this.backButton=button('Kembali ke Mini',()=>this.back());
        this.oldButton=button('Chat lama',()=>this.list());
        this.catalogButton=button('Daftar chat',()=>this.list());
        for(const b of [this.sendButton,this.stopButton,this.backButton,this.oldButton,this.catalogButton])controls.add_child(b);
        this.actor.add_child(controls);
        this.handoff=new St.BoxLayout({style_class:'ci-controls'});
        this.copyDraftButton=button('Salin draft',()=>this.copyDraft());
        this.desktopButton=button('Buka di Codex',()=>this.openDesktop());
        this.handoff.add_child(this.copyDraftButton);this.handoff.add_child(this.desktopButton);this.actor.add_child(this.handoff);
        this.state=new St.Label({text:'Enter kirim · Shift+Enter baris baru',style_class:'ci-meta'});this.actor.add_child(this.state);
        this.configure();this._renderConversation(true);this._buttons();
    }
    _inputHint(){return this.settings.get_boolean('enter-to-send')?'Enter kirim · Shift+Enter baris baru':'Ctrl+Enter kirim · Enter baris baru';}
    copyDraft(){
        const text=this.entry.get_text();if(!text){this.state.text='Tidak ada draft untuk disalin.';return;}
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD,text);this.state.text='Draft disalin · tempel di kolom pesan aplikasi Codex.';
    }
    openDesktop(){
        const id=this.previewMode==='transcript'?this.previewRow.id:this.threadId;
        if(!id||!/^\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b$/i.test(id)){this.state.text='Chat belum tersedia di aplikasi utama.';return;}
        const version=this.viewVersion;
        Gio.AppInfo.launch_default_for_uri_async(`codex://threads/${id}`,null,null,(_source,result)=>{
            try{Gio.AppInfo.launch_default_for_uri_finish(result);if(!this.dead&&version===this.viewVersion)this.state.text='Chat dibuka di Codex. Salin draft lalu tempel jika ingin melanjutkan di sana.';}
            catch{if(!this.dead&&version===this.viewVersion)this.state.text='Codex belum bisa dibuka. Periksa pemasangan aplikasi.';}
        });
    }
    configure(){
        if(this.state.text===(this._helpText||'Enter kirim · Shift+Enter baris baru'))this.state.text=this._inputHint();this._helpText=this._inputHint();
        this.scroll.height=this.settings.get_int('mini-height');
        this.body.set_style(`font-size: ${this.settings.get_int('mini-text-size')}px;`);
        if(this.previewMode==='catalog')this._renderCatalog();
    }
    async open(){
        if(this._opened)return;
        this._opened=true;this.historyLoading=true;this._buttons();const version=this.viewVersion;
        try{
            const r=await this.client.request('history');if(this.dead)return;this.threadId=r.threadId;
            if(!this.waiting&&!this.busy){this.conversation.load(r.messages);if(!this.preview)this._renderConversation(true);}
        }catch(e){if(!this.dead){this._opened=false;if(version===this.viewVersion)this.state.text=e.message;}}
        finally{if(!this.dead){this.historyLoading=false;this._buttons();}}
    }
    _buttons(){
        const composing=!this.preview||this.previewMode==='transcript';
        this.sendButton.reactive=this.sendButton.can_focus=!this.busy&&!this.waiting&&!this.historyLoading&&!this.reading&&!this.readFailed&&composing;
        this.sendButton.opacity=this.sendButton.reactive?255:90;this.sendButton.visible=composing;
        this.stopButton.visible=this.busy;this.entry.visible=composing;this.backButton.visible=this.preview;
        this.oldButton.visible=!this.preview;this.catalogButton.visible=this.previewMode==='transcript';
        this.search.visible=this.previewMode==='catalog';this.handoff.visible=composing;
        this.desktopButton.reactive=Boolean(this.previewMode==='transcript'?this.previewRow?.id:this.threadId);this.desktopButton.opacity=this.desktopButton.reactive?255:90;
        const away=this.replyTarget&&(this.previewMode==='catalog'||this._targetKey()!==this.replyTarget.key||this.readFailed);
        this.replyButton.visible=Boolean(away);
        if(away)this.replyButton.label=`${this.busy||this.waiting?'Sedang menjawab':this.replyState==='finished'?'Balasan selesai':'Kembali ke chat'}: ${this.replyTarget.title.slice(0,28)}`;
        this._updateLatest();
        this.reconnectButton.visible=this.connectionState!=='ready';
        this.reconnectButton.reactive=!this.busy&&!this.waiting&&this.connectionState!=='connecting';
    }
    async reconnect(){
        if(this.dead||this.busy||this.waiting||this.connectionState==='connecting')return;
        try{await this.client.request('connect');if(!this.dead){this.connectionState='ready';this.connection.text='Tersambung ke Codex';this._buttons();}}
        catch(e){if(!this.dead){this.connectionState='error';this.connection.text=e.message;this._buttons();}}
    }
    _targetKey(){return this.previewMode==='transcript'?this.previewRow.id:'mini';}
    _saveDraft(){if(!this.preview||this.previewMode==='transcript')this.chats.saveDraft(this._targetKey(),this.entry.get_text());}
    _restoreDraft(){this.entry.set_text(this.chats.draft(this._targetKey()));}
    _renderCurrent(force=false){
        if(this.previewMode==='catalog')return;
        const c=this.chats.get(this._targetKey(),this.sendingKey);
        if(this.previewMode==='transcript')this.previewMessages=c.rows;
        this._showMessages(c.rows,force);
    }
    async send(){
        if(this.dead||this.busy||this.waiting||this.historyLoading||this.reading||this.readFailed||this.previewMode==='catalog')return;
        const text=this.entry.get_text();if(!text.trim())return;
        if(text.length>8000){this.state.text='Pesan maksimal 8000 karakter.';return;}
        const key=this._targetKey();const c=this.chats.get(key,this.sendingKey);this._saveDraft();this.sendingKey=key;
        this.replyTarget={key,title:key==='mini'?'Mini':this.previewRow.title,row:key==='mini'?null:{...this.previewRow}};this.replyState='working';
        this.waiting=true;c.begin(text);this._renderCurrent(true);this._buttons();this.state.text='Mengirim pesan…';
        try{
            const params=key==='mini'?{text,cwd:this.settings.get_string('working-directory')||GLib.get_home_dir()}:{text,threadId:key};
            const r=await this.client.request('send',params);
            if(this.dead)return;if(key==='mini')this.threadId=r.threadId;
            if(this._targetKey()===key&&this.previewMode!=='catalog')this._saveDraft();
            this.chats.acceptDraft(key,text);
            if(this._targetKey()===key&&this.previewMode!=='catalog')this._restoreDraft();
        }catch(e){if(!this.dead){if(!this.busy){c.reject();this.replyState='error';}this.state.text=e.message;}}
        finally{if(!this.dead){this.waiting=false;this._clearSeenReply();this._buttons();this._renderCurrent(this._targetKey()===key&&this.previewMode!=='catalog');}}
    }
    event(e){
        if(this.dead)return;
        if(e.event==='turn'){
            if(e.state==='working'&&!this.sendingKey)this.sendingKey=e.threadId===this.threadId?'mini':e.threadId;
            this.busy=e.state==='working';
            this.state.text={working:'Codex sedang menjawab…',finished:'Selesai · lanjutkan percakapan',cancelled:'Balasan dihentikan',error:'Codex gagal menjawab; coba lagi atau buka aplikasi utama.'}[e.state]||e.state;
            if(e.state!=='working'){this.sendingKey=null;this.replyState=e.state;this._clearSeenReply();}
            this._buttons();
        }else if(['delta','message'].includes(e.event)){
            const key=this.sendingKey||(e.threadId&&e.threadId!==this.threadId?e.threadId:'mini');
            this.chats.get(key,this.sendingKey).receive(e);
            if(!this._renderTimer)this._renderTimer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,100,()=>{
                this._renderTimer=null;if(!this.dead)this._renderCurrent(false);return GLib.SOURCE_REMOVE;
            });
        }else if(e.event==='connection'){
            this.connectionState=e.state;this.connection.text=e.text||'Koneksi belum siap.';
            this.connection.style_class=`ci-connection ci-connection-${e.state}`;
            if(['idle','error'].includes(e.state)){this.busy=false;this._opened=false;if(e.state==='error')this.replyState='error';}
            this._buttons();
        }else if(e.event==='notice')this.state.text=e.text;
    }
    _clearSeenReply(){
        if(!this.busy&&!this.waiting&&!this.reading&&!this.readFailed&&this.replyTarget&&this.previewMode!=='catalog'&&this._targetKey()===this.replyTarget.key)this.replyTarget=null;
    }
    returnToReply(){
        const target=this.replyTarget;if(!target)return;
        if(target.key==='mini')this.back();else void this.read(target.row);
    }
    _updateLatest(){
        const a=this._adjustment();this.latestButton.visible=Boolean(this.previewMode!=='catalog'&&a&&a.upper-a.page_size-a.value>35);
    }
    jumpLatest(){
        if(this._scrollTimer)GLib.Source.remove(this._scrollTimer);this._scrollTimer=null;
        const a=this._adjustment();if(a)a.value=Math.max(a.lower,a.upper-a.page_size);this._updateLatest();
    }
    _adjustment(){return this.scroll.vadjustment??this.scroll.get_vscroll_bar?.()?.get_adjustment();}
    _renderConversation(force){if(!this.preview)this._showMessages(this.conversation.rows,force);}
    _showMessages(messages,force=false){
        const adjustment=this._adjustment();
        const follow=force||!adjustment||adjustment.upper-adjustment.page_size-adjustment.value<35;
        const version=this.viewVersion;const previousValue=adjustment?.value;
        const next=new Map();
        for(const [index,m] of messages.entries()){
            const key=m.key||m.id||`${m.role}-${index}`;
            let bubble=this.bubbles.get(key);
            if(!bubble){
                const actor=new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL,style_class:`ci-bubble ${m.role==='Kamu'?'ci-bubble-user':'ci-bubble-codex'}`,x_expand:true});
                const header=new St.BoxLayout({style_class:'ci-bubble-header'});
                const name=new St.Label({text:m.role,style_class:'ci-bubble-name',x_expand:true});
                const label=textLabel(m.text,'ci-bubble-text');label.clutter_text.selectable=true;label.width=320;
                const copy=button('Salin',()=>{St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD,label.text+(bubble.truncated?'\n\n[Cuplikan — baca pesan lengkap di aplikasi Codex.]':''));this.state.text=bubble.truncated?'Cuplikan disalin · pesan lengkap di Codex':'Pesan disalin';});
                header.add_child(name);header.add_child(copy);actor.add_child(header);actor.add_child(label);
                bubble={actor,name,label,copy};
            }
            bubble.truncated=Boolean(m.truncated);bubble.copy.label=m.truncated?'Salin cuplikan':'Salin';
            bubble.name.text=m.failed?`${m.role} · belum terkirim`:m.truncated?`${m.role} · cuplikan`:m.role;
            bubble.label.text=m.text;next.set(key,bubble);
        }
        const reusable=new Set([...this.bubbles.values()].map(b=>b.actor));
        for(const c of this.body.get_children()){this.body.remove_child(c);if(!reusable.has(c))c.destroy();}
        for(const [key,b] of this.bubbles)if(!next.has(key))b.actor.destroy();
        this.bubbles=next;
        if(this.previewMode==='transcript'&&this.previewCursor&&messages.length<64){
            const older=button('Muat pesan sebelumnya',()=>this.read(this.previewRow,true));older.reactive=!this.reading;this.body.add_child(older);
        }
        if(!messages.length)this.body.add_child(textLabel(this.previewMode==='transcript'?'Tulis pesan untuk melanjutkan chat ini.':'Tulis pesan untuk Codex. Percakapan Mini disimpan pada chat khusus Island.','ci-subtitle'));
        for(const b of next.values())this.body.add_child(b.actor);
        if(this._scrollTimer)GLib.Source.remove(this._scrollTimer);
        this._scrollTimer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,80,()=>{
            this._scrollTimer=null;if(!this.dead&&version===this.viewVersion&&this.previewMode!=='catalog'){
                const a=this._adjustment();if(a&&follow&&a.value===previousValue)a.value=Math.max(a.lower,a.upper-a.page_size);this._updateLatest();
            }return GLib.SOURCE_REMOVE;
        });
    }
    _clearBody(){
        for(const c of this.body.get_children())c.destroy();this.bubbles.clear();
    }
    async stop(){this.state.text='Menghentikan balasan…';try{await this.client.request('interrupt');}catch(e){if(!this.dead)this.state.text=e.message;}}
    async list(){
        this._saveDraft();this.preview=true;this.previewMode='catalog';this.notice.text='Pilih percakapan';this._clearBody();this._buttons();await this._loadChats(false);
    }
    async _loadChats(append){
        const version=++this.viewVersion;const query=this.search.get_text();this.state.text='Memuat chat…';
        try{
            const r=await this.client.request('list',{paged:true,query,cursor:append?this.catalogCursor:undefined,pins:this.settings.get_strv('pinned-chats')});
            if(this.dead||version!==this.viewVersion||this.previewMode!=='catalog')return;
            this.catalog=append?[...this.catalog,...r.rows]:r.rows;this.catalogCursor=r.nextCursor;this._renderCatalog();
            this.state.text='Pilih chat untuk dibaca atau dilanjutkan · pin tersimpan lokal';
        }catch(e){if(!this.dead&&version===this.viewVersion)this.state.text=e.message;}
    }
    _renderCatalog(){
        this._clearBody();const pins=this.settings.get_strv('pinned-chats');
        const rows=chatRows(this.catalog,pins,this.search.get_text());
        if(!rows.length)this.body.add_child(textLabel('Tidak ada chat yang cocok.','ci-subtitle'));
        for(const row of rows){
            const item=new St.BoxLayout({style_class:'ci-catalog-row'});
            const content=new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL,x_expand:true});
            const title=textLabel(row.title,'ci-project');title.width=285;content.add_child(title);
            content.add_child(new St.Label({text:row.project||'Tanpa proyek',style_class:'ci-meta'}));
            const open=new St.Button({child:content,style_class:'ci-chat-open',x_expand:true,can_focus:true});open.connect('clicked',()=>this.read(row));
            const pin=button(pins.includes(row.id)?'★':'☆',()=>this.pin(row));pin.accessible_name=pins.includes(row.id)?'Lepas pin chat':'Pin chat';
            item.add_child(open);item.add_child(pin);this.body.add_child(item);
        }
        if(this.catalogCursor){const more=button('Muat chat lainnya',()=>this._loadChats(true));this.body.add_child(more);}
    }
    pin(row){
        const pins=this.settings.get_strv('pinned-chats');
        if(pins.includes(row.id))this.settings.set_strv('pinned-chats',pins.filter(id=>id!==row.id));
        else if(pins.length<12)this.settings.set_strv('pinned-chats',[...pins,row.id]);
        else this.state.text='Maksimal 12 chat terpin.';
    }
    async read(row,older=false){
        if(older&&(this.reading||!this.previewCursor||this.previewMessages.length>=64))return;
        if(this._searchTimer)GLib.Source.remove(this._searchTimer);this._searchTimer=null;
        if(!older)this._saveDraft();
        const c=this.chats.get(row.id,this.sendingKey);const turn=c.turn;const wasSending=this.sendingKey===row.id&&(this.busy||this.waiting);
        const cursor=older?this.previewCursor:undefined;const version=++this.viewVersion;
        this.preview=true;this.previewMode='transcript';this.previewRow=row;this.reading=true;this.readFailed=false;this.notice.text=`Chat: ${row.title}`;this.notice.clutter_text.ellipsize=Pango.EllipsizeMode.END;this.notice.width=370;
        if(!older)this._restoreDraft();
        if(!older){this.previewMessages=[];this.previewCursor=null;this._clearBody();}
        this._buttons();this.state.text='Membaca percakapan…';
        try{
            const r=await this.client.request('read',{threadId:row.id,cursor});
            if(this.dead||version!==this.viewVersion||this.previewMode!=='transcript')return;
            if(older)c.rows=prependPage(r.messages,c.rows);
            else if(!wasSending&&c.turn===turn&&!(this.sendingKey===row.id&&(this.busy||this.waiting)))c.refresh(r.messages);
            else c.load(r.messages);
            this.previewMessages=c.rows;this.previewCursor=r.nextCursor;
            this.reading=false;this._clearSeenReply();this._buttons();this._showMessages(this.previewMessages,!older);
            this.state.text=`Kirim ke ${row.title.slice(0,32)}${this.previewMessages.length>=64?' · batas 64 pesan':''}`;
            const a=this._adjustment();if(older&&a)a.value=a.lower;
        }catch(e){if(!this.dead&&version===this.viewVersion){this.reading=false;this.readFailed=true;this._buttons();this.state.text=e.message;}}
    }
    back(){
        this._saveDraft();
        ++this.viewVersion;if(this._searchTimer)GLib.Source.remove(this._searchTimer);this._searchTimer=null;
        this.preview=false;this.previewMode=null;this.reading=false;this.readFailed=false;this.notice.text='Chat khusus Island';this._restoreDraft();this._clearBody();this._clearSeenReply();this._buttons();this._renderConversation(true);
        this.state.text=this.busy?'Codex sedang menjawab…':this._inputHint();
        if(!this._opened&&!this.busy&&!this.waiting)void this.open();
    }
    destroy(){
        this.dead=true;
        const adjustment=this._adjustment();for(const id of this._adjustmentSignals)adjustment.disconnect(id);this._adjustmentSignals=[];
        for(const key of ['_renderTimer','_scrollTimer','_searchTimer']){if(this[key])GLib.Source.remove(this[key]);this[key]=null;}
    }
}
