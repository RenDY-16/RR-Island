"""Replace files without changing an inode already mapped by a live reader."""
import os, shutil, tempfile
from pathlib import Path

def copy_atomic(source, target):
    source, target = Path(source), Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and not target.is_symlink() and source.read_bytes() == target.read_bytes():
        return
    fd, name = tempfile.mkstemp(prefix='.'+target.name+'.', dir=target.parent)
    os.close(fd)
    try:
        shutil.copy2(source, name)
        os.replace(name, target)
    finally:
        Path(name).unlink(missing_ok=True)

def copy_tree_atomic(source, target):
    source, target = Path(source), Path(target)
    target.mkdir(parents=True, exist_ok=True)
    for item in sorted(source.rglob('*')):
        destination = target/item.relative_to(source)
        if item.is_dir():destination.mkdir(parents=True, exist_ok=True)
        elif item.is_file():copy_atomic(item, destination)
