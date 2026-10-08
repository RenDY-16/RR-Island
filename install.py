#!/usr/bin/python3
import json, shutil, subprocess, datetime
from pathlib import Path
from file_ops import copy_atomic, copy_tree_atomic
ROOT=Path(__file__).resolve().parent
UUID='codex-island@rendy.local'
home=Path.home()
backup=home/'.local/state/codex-island-backups'/datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
backup.mkdir(parents=True,mode=0o700)
hooks=home/'.codex/hooks.json'
if hooks.exists(): shutil.copy2(hooks,backup/'hooks.json')
enabled=subprocess.check_output(['gsettings','get','org.gnome.shell','enabled-extensions'],text=True)
(backup/'enabled-extensions.txt').write_text(enabled)
dest=home/'.local/share/gnome-shell/extensions'/UUID
if dest.exists(): shutil.copytree(dest,backup/'extension')
subprocess.run(['glib-compile-schemas','--strict',str(ROOT/'extension/schemas')],check=True)
copy_tree_atomic(ROOT/'extension',dest)
relay=home/'.local/share/codex-island/hook.py'
relay.parent.mkdir(parents=True,exist_ok=True)
copy_atomic(ROOT/'hook.py',relay)
relay.chmod(0o755)
bridge=relay.parent/'bridge.py'
if bridge.exists(): shutil.copy2(bridge,backup/'bridge.py')
copy_atomic(ROOT/'bridge.py',bridge);bridge.chmod(0o755)
data=json.loads(hooks.read_text()) if hooks.exists() else {}
all_hooks=data.setdefault('hooks',{})
command='/usr/bin/python3 '+str(relay)
for event in ['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','Stop','StopFailure','SessionEnd']:
    groups=all_hooks.setdefault(event,[])
    # Replace only this monitoring path; retain unrelated hooks and matchers.
    for group in groups:
        group['hooks']=[h for h in group.get('hooks',[]) if 'coucou-hook --agent codex' not in h.get('command','') and str(relay) not in h.get('command','')]
    groups[:]=[g for g in groups if g.get('hooks')]
    entry={'type':'command','command':command,'timeout':2}
    if event!='SessionEnd': entry['async']=True
    groups.append({'hooks':[entry]})
for event in ['SubagentStart','SubagentStop']:
    for group in all_hooks.get(event,[]):
        group['hooks']=[h for h in group.get('hooks',[]) if 'coucou-hook --agent codex' not in h.get('command','')]
    if event in all_hooks: all_hooks[event]=[g for g in all_hooks[event] if g.get('hooks')]
hooks.write_text(json.dumps(data,indent=2)+'\n');hooks.chmod(0o600)
# GVariant parsing via literal_eval handles the existing string-array value.
import ast
names=ast.literal_eval(enabled.strip().removeprefix('@as '))
if UUID not in names: names.append(UUID)
subprocess.run(['gsettings','set','org.gnome.shell','enabled-extensions',str(names)],check=True)
print('Installed extension:',dest)
print('Installed relay:',relay)
print('Backup:',backup)
