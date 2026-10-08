#!/usr/bin/python3
"""Explicit recovery: restore the latest pre-install hooks and extension list."""
import subprocess, shutil
from pathlib import Path
from file_ops import copy_atomic, copy_tree_atomic
home=Path.home()
backups=sorted((home/'.local/state/codex-island-backups').glob('*'))
if not backups: raise SystemExit('No backup found; nothing changed.')
backup=backups[-1]
if (backup/'hooks.json').exists(): copy_atomic(backup/'hooks.json',home/'.codex/hooks.json')
if (backup/'extension').exists():
    copy_tree_atomic(backup/'extension',home/'.local/share/gnome-shell/extensions/codex-island@rendy.local')
if (backup/'bridge.py').exists():copy_atomic(backup/'bridge.py',home/'.local/share/codex-island/bridge.py')
subprocess.run(['gsettings','set','org.gnome.shell','enabled-extensions',(backup/'enabled-extensions.txt').read_text().strip()],check=True)
print('Restored:',backup)
print('The extension files remain available, but the original enabled list is restored.')
