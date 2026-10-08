import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {summarize, visibleSessions} from './model.js';
import {createCharacter, updateCharacter} from './character.js';
import {BridgeClient} from './client.js';
import {MiniPane} from './mini.js';
import {UsagePane} from './usage.js';
import {PetMotion} from './pet-motion.js';

const WORDS = {idle:'Siap', thinking:'Berpikir', working:'Bekerja',
    finished:'Selesai', error:'Ada kendala', stale:'Status belum diperbarui'};
const TOOLS = {exec_command:'Terminal', apply_patch:'Mengedit file', web__run:'Web',
    write_stdin:'Terminal', image_gen__imagegen:'Membuat gambar'};

export default class CodexIsland extends Extension {
    enable() {
        this._closing=false;
        this._petMotion=new PetMotion();this._miniResult=null;
        this._settings = this.getSettings();
        this._desktop = new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
        this._button = new PanelMenu.Button(0.5, 'RR-Island', false);
        this._button.add_style_class_name('ci-button');
        this._button.set_style('background-color: transparent; box-shadow: none;');
        this._pill = new St.BoxLayout({style_class:'ci-pill'});
        this._characterSlot = new St.Widget({width:22,height:22,layout_manager:new Clutter.FixedLayout()});
        this._character = createCharacter(44,`${this.path}/assets/rakit.png`);
        this._characterSlot.add_child(this._character);
        this._icon = new St.Icon({gicon:Gio.icon_new_for_string(`${this.path}/codex-symbolic.svg`), icon_size:16});
        this._name = new St.Label({text:'RR-Island', y_align:Clutter.ActorAlign.CENTER});
        this._dot = new St.Label({text:'·', style_class:'ci-dot', y_align:Clutter.ActorAlign.CENTER});
        this._detail = new St.Label({text:'', y_align:Clutter.ActorAlign.CENTER, style_class:'ci-detail'});
        for (const actor of [this._characterSlot,this._icon,this._name,this._dot,this._detail]) this._pill.add_child(actor);
        this._button.add_child(this._pill);
        this._button.menu.box.add_style_class_name('ci-menu');
        const header = new PopupMenu.PopupBaseMenuItem({reactive:false});
        header.add_style_class_name('ci-header');
        this._portrait = createCharacter(96,`${this.path}/assets/rakit.png`);
        this._petButton=new St.Button({child:this._portrait,style_class:'ci-pet-button',can_focus:true,accessible_name:'Rakit · klik untuk bereaksi'});
        this._petButton.connect('clicked',()=>this._playPet('jumping'));header.add_child(this._petButton);
        const intro = new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL, y_align:Clutter.ActorAlign.CENTER});
        intro.add_child(new St.Label({text:'RR-Island · Rakit', style_class:'ci-title'}));
        this._statusLabel = new St.Label({text:'Siap menemani', style_class:'ci-subtitle'});
        intro.add_child(this._statusLabel);
        header.add_child(intro);
        this._button.menu.addMenuItem(header);
        const tabRow = new PopupMenu.PopupBaseMenuItem({reactive:false});
        tabRow.add_style_class_name('ci-tabs');
        const tab = (label,key) => {
            const b = new St.Button({label,style_class:'ci-tab',can_focus:true,x_expand:true});
            b.connect('clicked',()=>this._selectSection(key));tabRow.add_child(b);return b;
        };
        this._activityTab=tab('Aktivitas','activity');
        this._miniTab=tab('Mini','mini');
        this._usageTab=tab('Usage','usage');
        this._button.menu.addMenuItem(tabRow);
        this._activity = new PopupMenu.PopupMenuSection();
        this._button.menu.addMenuItem(this._activity);
        this._statusRow = new PopupMenu.PopupMenuItem('', {reactive:false});
        this._statusRow.add_style_class_name('ci-summary');
        this._activity.addMenuItem(this._statusRow);
        this._activity.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._sessions = new PopupMenu.PopupMenuSection();
        this._activity.addMenuItem(this._sessions);
        this._filter = new PopupMenu.PopupSwitchMenuItem('Hanya sesi aktif', this._settings.get_boolean('active-only'));
        this._filter.connect('toggled', (_item,value) => this._settings.set_boolean('active-only',value));
        this._activity.addMenuItem(this._filter);
        this._client = new BridgeClient(this._bridgeArgv());
        this._mini = new MiniPane(this._client,this._settings);
        this._usage = new UsagePane(this._client);
        this._client.onEvent = e => {
            this._mini.event(e);
            if(e.event==='turn'){
                this._miniResult=['finished','error'].includes(e.state)?e.state:null;this._miniResultUntil=Date.now()+8000;
                if(e.state==='finished')this._playPet('review');
                if(e.state==='error')this._playPet('error');
            }
            this._tick();
        };
        this._miniItem = new PopupMenu.PopupBaseMenuItem({reactive:false});
        this._miniItem.add_child(this._mini.actor);
        this._usageItem = new PopupMenu.PopupBaseMenuItem({reactive:false});
        this._usageItem.add_child(this._usage.actor);
        this._button.menu.addMenuItem(this._miniItem);
        this._button.menu.addMenuItem(this._usageItem);
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._section='activity';
        this._preferences = new PopupMenu.PopupMenuItem('Pengaturan…');
        this._preferences.connect('activate', () => this.openPreferences());
        this._button.menu.addMenuItem(this._preferences);
        const footer = new PopupMenu.PopupMenuItem('Lokal · tanpa API key', {reactive:false});
        footer.add_style_class_name('ci-footer');
        this._button.menu.addMenuItem(footer);
        this._button.menu.connect('open-state-changed',(_menu,open)=>{
            if(open){this._selectSection(this._section);this._playPet('waving');}
            this._tick();
        });
        Main.panel.addToStatusArea(this.uuid, this._button, 0, ['left','center','right'][this._settings.get_int('position')]);
        this._file = Gio.File.new_for_path(`${GLib.get_user_cache_dir()}/codex-island/status.json`);
        this._frame = 0;
        this._faceFrame = 0;
        this._last = '';
        this._status = 'idle';
        this._settingsChanged = this._settings.connect('changed', () => this._applySettings());
        this._desktopChanged = this._desktop.connect('changed::enable-animations', () => this._applySettings());
        this._applySettings();
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _applySettings() {
        const s = this._settings;
        const size = [18,22,26][s.get_int('size')];
        // Paint beyond the panel's layout slot without scaling a small bitmap
        // or increasing the top bar's height. Ancestors keep their normal input region.
        this._characterSlot.set_size(size,size);
        this._character.set_size(size*2,size*2);
        this._character.set_position(-size/2,0);
        this._icon.icon_size = size-4;
        this._name.visible = s.get_boolean('show-label');
        this._character.visible = s.get_boolean('show-character');
        this._characterSlot.visible = this._character.visible;
        this._icon.visible = !this._character.visible;
        this._portrait.visible = this._character.visible;
        this._portrait.set_size(s.get_int('pet-size'),s.get_int('pet-size'));
        this._pill.set_style(`font-size: ${[11,12,13][s.get_int('size')]}px; padding: 1px ${[8,10,12][s.get_int('size')]}px;`);
        const box = [Main.panel._leftBox,Main.panel._centerBox,Main.panel._rightBox][s.get_int('position')];
        const actor = this._button.container;
        if (actor.get_parent() !== box) {
            actor.get_parent()?.remove_child(actor);
            box.insert_child_at_index(actor,0);
        }
        this._animate = s.get_boolean('animations') && this._desktop.get_boolean('enable-animations');
        if (this._animationTimer) GLib.Source.remove(this._animationTimer);
        this._animationTimer = null;
        if (this._animate && this._character.visible) {
            this._animationTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT,120,()=>{
                this._faceFrame++;
                this._renderPet();
                return GLib.SOURCE_CONTINUE;
            });
        }
        this._filter.setToggleState(s.get_boolean('active-only'));
        this._mini.configure();
        this._miniTab.visible=s.get_boolean('show-mini');
        this._usageTab.visible=s.get_boolean('show-usage');
        if ((this._section==='mini'&&!this._miniTab.visible)||(this._section==='usage'&&!this._usageTab.visible))this._section='activity';
        this._selectSection(this._section,false);
        this._last = '';
        this._tick();
    }

    _bridgeArgv() {
        return ['/usr/bin/python3',`${GLib.get_user_data_dir()}/codex-island/bridge.py`,'--cwd',this._settings.get_string('working-directory')];
    }

    _playPet(action){
        if(!this._settings||!this._petMotion)return;
        if(this._petMotion.trigger(action,GLib.get_monotonic_time()/1000,this._animate,this._settings.get_int('pet-intensity')))this._renderPet();
    }

    _renderPet(){
        const pose=this._petMotion.pose(this._status,this._faceFrame,GLib.get_monotonic_time()/1000,this._animate,this._settings.get_int('pet-intensity'));
        if(this._button.visible)updateCharacter(this._character,pose.status,pose.frame,this._animate);
        if(this._button.menu.isOpen)updateCharacter(this._portrait,pose.status,pose.frame,this._animate);
    }

    _selectSection(section,load=true) {
        this._section=section;
        this._activity.actor.visible=section==='activity';
        this._miniItem.visible=section==='mini';
        this._usageItem.visible=section==='usage';
        for(const [key,b] of [['activity',this._activityTab],['mini',this._miniTab],['usage',this._usageTab]])
            b.style_class=`ci-tab${key===section?' ci-tab-selected':''}`;
        if(load&&this._button.menu.isOpen){
            if(section==='mini')void this._mini.open();
            if(section==='usage')void this._usage.open();
        }
    }

    _tick() {
        if(this._closing)return;
        let data = {};
        let broken = false;
        try {
            const [ok, bytes] = this._file.load_contents(null);
            if (ok) data = JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            broken = this._file.query_exists(null);
        }
        const now = Date.now()/1000;
        const result = summarize(data, now);
        if (broken) result.status = 'error';
        if(this._mini.busy||this._mini.waiting){result.status='working';result.active++;}
        else if(!result.active&&result.status==='idle'&&this._miniResult&&Date.now()<this._miniResultUntil)result.status=this._miniResult;
        if(this._status!==result.status)this._faceFrame=0;
        this._status = result.status;
        const busy = result.active > 0;
        this._frame++;
        this._dot.text = busy ? (this._animate ? ['·','··','···'][this._frame % 3] : '·')
            : result.status === 'finished' ? '✓'
            : ['error','stale'].includes(result.status) ? '!' : '·';
        const detail = busy ? `${WORDS[result.status]}${result.active > 1 ? ` · ${result.active}` : ''}`
            : result.status === 'idle' ? '' : WORDS[result.status];
        this._detail.text = detail;
        this._detail.visible = Boolean(detail);
        this._button.visible = !this._settings.get_boolean('hide-idle') || result.status !== 'idle' || this._button.menu.isOpen || this._mini.busy;
        this._pill.style_class = `ci-pill ci-${result.status}`;
        this._button.accessible_name = `Codex: ${WORDS[result.status]}, ${result.active} sesi aktif`;
        this._renderPet();
        const key = `${Math.floor(now/60)}:${JSON.stringify(result)}`;
        if (key === this._last) return;
        this._last = key;
        this._pill.remove_all_transitions();
        if (this._animate) {
            this._pill.opacity = 180;
            this._pill.ease({opacity:255, duration:220, mode:Clutter.AnimationMode.EASE_OUT_QUAD});
        } else this._pill.opacity = 255;
        this._statusLabel.text = broken ? 'File status tidak terbaca' : `${WORDS[result.status]}${busy ? ' · sedang menemani pekerjaanmu' : ' · siap menemani'}`;
        this._statusRow.label.text = `${result.active} aktif  ·  ${result.sessions.length} sesi dalam 24 jam`;
        this._sessions.removeAll();
        const selected = visibleSessions(result,{maxSessions:this._settings.get_int('max-sessions'),activeOnly:this._settings.get_boolean('active-only')});
        if (!selected.length) {
            this._sessions.addMenuItem(new PopupMenu.PopupMenuItem(result.sessions.length ? 'Tidak ada sesi aktif.' : 'Belum ada sesi. Kirim pesan di Codex.', {reactive:false}));
        }
        for (const session of selected) {
            const item = new PopupMenu.PopupBaseMenuItem({reactive:false});
            item.add_style_class_name('ci-session');
            const box = new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL, x_expand:true});
            const project = new St.Label({text:session.project || 'Codex', style_class:'ci-project'});
            const age = Math.max(0, Math.floor((now - session.updated)/60));
            const tool = session.tool ? ` · ${TOOLS[session.tool] || session.tool}` : '';
            const text = `${WORDS[session.status] || 'Status tidak dikenal'}${tool}`;
            box.add_child(project);
            box.add_child(new St.Label({text, style_class:'ci-subtitle'}));
            box.add_child(new St.Label({text:`${session.id.slice(0,8)} · ${age ? `${age} menit lalu` : 'baru saja'}`,style_class:'ci-meta'}));
            item.add_child(box);
            const copy = new St.Button({style_class:'ci-copy', can_focus:true, accessible_name:'Salin ID sesi', y_align:Clutter.ActorAlign.CENTER,
                child:new St.Icon({icon_name:'edit-copy-symbolic',icon_size:14})});
            copy.connect('clicked', () => {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD,session.id);
                this._statusRow.label.text = `ID sesi ${session.id.slice(0,8)} disalin`;
            });
            item.add_child(copy);
            this._sessions.addMenuItem(item);
        }
    }

    disable() {
        this._closing=true;
        if (this._timer) GLib.Source.remove(this._timer);
        if (this._animationTimer) GLib.Source.remove(this._animationTimer);
        this._timer = this._animationTimer = null;
        if (this._settingsChanged) this._settings.disconnect(this._settingsChanged);
        if (this._desktopChanged) this._desktop.disconnect(this._desktopChanged);
        this._settingsChanged = this._desktopChanged = null;
        this._pill?.remove_all_transitions();
        this._mini?.destroy();this._usage?.destroy();this._client?.destroy();
        this._button?.destroy();
        this._button = this._pill = this._file = this._characterSlot = null;
        this._settings = this._desktop = null;
        this._mini = this._usage = this._client = null;
    }
}
