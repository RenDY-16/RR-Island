import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class CodexIslandPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(540, 670);
        const page = new Adw.PreferencesPage({title:'RR-Island', icon_name:'preferences-system-symbolic'});
        window.add(page);
        const appearance = new Adw.PreferencesGroup({title:'Tampilan', description:'Perubahan langsung berlaku. Tema hitam OLED tetap dipertahankan.'});
        page.add(appearance);
        const combo = (key, title, values) => {
            const row = new Adw.ComboRow({title, model:Gtk.StringList.new(values), selected:settings.get_int(key)});
            row.connect('notify::selected', () => settings.set_int(key, row.selected));
            settings.connect(`changed::${key}`, () => {row.selected = settings.get_int(key);});
            appearance.add(row);
        };
        combo('position', 'Posisi di panel atas', ['Kiri', 'Tengah', 'Kanan']);
        combo('size', 'Ukuran Island', ['Ringkas', 'Normal', 'Besar']);
        combo('pet-intensity','Gerakan pet',['Tenang','Normal','Aktif']);
        const petSize=new Adw.SpinRow({title:'Ukuran pet',adjustment:new Gtk.Adjustment({lower:64,upper:112,step_increment:8,page_increment:8}),digits:0});
        settings.bind('pet-size',petSize,'value',Gio.SettingsBindFlags.DEFAULT);appearance.add(petSize);
        const toggle = (group, key, title, subtitle) => {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        };
        toggle(appearance, 'show-label', 'Nama RR-Island', 'Tampilkan nama di samping karakter.');
        toggle(appearance, 'show-character', 'Karakter', 'Pet Rakit dari Mini Codex, dengan animasi sesuai status.');
        toggle(appearance, 'animations', 'Animasi', 'Gerakan mata, kedipan, dan transisi. Mengikuti pengaturan animasi GNOME.');
        toggle(appearance, 'hide-idle', 'Sembunyikan saat siap', 'Island muncul kembali saat ada aktivitas. Pengaturan tetap tersedia di Extension Manager.');
        const sessions = new Adw.PreferencesGroup({title:'Daftar sesi', description:'Sesi aktif ditampilkan lebih dahulu. Isi percakapan tidak disimpan.'});
        page.add(sessions);
        toggle(sessions, 'active-only', 'Hanya sesi aktif', 'Sembunyikan sesi yang selesai, siap, atau statusnya kedaluwarsa.');
        const limit = new Adw.SpinRow({title:'Jumlah sesi', adjustment:new Gtk.Adjustment({lower:1, upper:12, step_increment:1, page_increment:1}), digits:0});
        settings.bind('max-sessions', limit, 'value', Gio.SettingsBindFlags.DEFAULT);
        sessions.add(limit);
        const mini = new Adw.PreferencesGroup({title:'Mini dan Usage',description:'Mini memakai batas akun Codex. Chat lama dapat dilanjutkan ketika tersedia.'});
        page.add(mini);
        toggle(mini,'show-mini','Tampilkan Mini','Chat langsung di dropdown Island.');
        toggle(mini,'enter-to-send','Enter untuk mengirim','Jika dimatikan: Enter membuat baris baru, Ctrl+Enter mengirim.');
        toggle(mini,'show-usage','Tampilkan Usage','Batas akun diperbarui saat dibuka; tanpa polling latar.');
        for(const [key,title,lower,upper,step] of [['mini-height','Tinggi balasan Mini',140,380,20],['mini-text-size','Ukuran teks Mini',11,18,1]]) {
            const row = new Adw.SpinRow({title,adjustment:new Gtk.Adjustment({lower,upper,step_increment:step,page_increment:step}),digits:0});
            settings.bind(key,row,'value',Gio.SettingsBindFlags.DEFAULT);mini.add(row);
        }
        const folder=new Adw.EntryRow({title:'Folder kerja Mini (kosong = folder home)'});
        settings.bind('working-directory',folder,'text',Gio.SettingsBindFlags.DEFAULT);mini.add(folder);
        const other = new Adw.PreferencesGroup({title:'Pemulihan', description:'Pengaturan disimpan lokal untuk akun ini. Tidak memerlukan API key.'});
        page.add(other);
        const reset = new Adw.ActionRow({title:'Kembalikan pengaturan awal', subtitle:'Hanya pengaturan RR-Island yang direset.'});
        const button = new Gtk.Button({label:'Reset', valign:Gtk.Align.CENTER});
        button.connect('clicked', () => {
            for (const key of settings.settings_schema.list_keys()) settings.reset(key);
        });
        reset.add_suffix(button);
        other.add(reset);
    }
}
