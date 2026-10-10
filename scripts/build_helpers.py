import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist" / "bin"


def main():
    pyinstaller = shutil.which("pyinstaller")
    if not pyinstaller:
        raise SystemExit("PyInstaller is required. Install it with: python -m pip install pyinstaller")
    DIST.mkdir(parents=True, exist_ok=True)
    work = ROOT / "build" / "pyinstaller"
    for name, entry in (("rr-island-bridge", "bridge.py"), ("rr-island-hook", "hook.py")):
        subprocess.run([
            pyinstaller, "--noconfirm", "--clean", "--onefile", "--name", name,
            "--distpath", str(DIST), "--workpath", str(work / name),
            "--specpath", str(work / "spec"), str(ROOT / entry),
        ], check=True, cwd=ROOT)
    print(f"Built platform helpers in {DIST}")


if __name__ == "__main__":
    main()
