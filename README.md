# RR-Island

RR-Island is a local companion for Codex. The repository contains an Electron desktop app for Windows and Linux and an optional GNOME Shell panel extension.

## Desktop app

The desktop app includes local activity status, the Rakit pet, Mini chat, Codex usage, and preferences. Mini can start a separate chat or continue a selected Codex conversation. Existing chats keep the permissions already stored by Codex. RR-Island does not override Codex tool approvals.

The app uses a Codex CLI already installed and signed in on the computer. It communicates with `codex app-server --stdio` through a bundled local bridge. The app does not require a separately installed Node.js or Python runtime and does not use an API key or separate paid service.

For regular use, download the Windows x64 installer (`.exe`) or Linux x64 AppImage from [GitHub Releases](https://github.com/RenDY-16/RR-Island/releases). No repository clone or `npm install` is needed. The activity hook is optional; RR-Island asks before adding its status-only entries to `~/.codex/hooks.json`. Hook entries owned by other tools are preserved, and the original file is backed up before changes. Activity metadata includes project and tool names; prompt and response contents are not stored.

## GNOME Shell extension

The original panel extension remains available for Fedora and GNOME Shell 50. Review `install.py` before running it. The installer copies the extension and helper, enables the extension in the current GNOME session, and adds a status hook to Codex configuration.

```bash
python3 install.py
```

On Wayland, log out and back in normally after changing extension code so GNOME loads it. To restore the latest full GNOME-install backup, review `restore.py` and run:

```bash
python3 restore.py
```

The app's safe hook toggle only removes entries marked as RR-Island-owned. The legacy GNOME `restore.py` restores the full backed-up hooks file and extension list, so inspect the backup and review its effect before running it if Codex hooks changed since installation.

## Development

Requirements: Node.js 24+, Python 3.12+, and PyInstaller. Build on the same OS as the target package; PyInstaller does not cross-compile helpers.

```bash
npm ci
npm test
python -m unittest discover -s tests -p 'test_*.py' -v
python -m py_compile bridge.py file_ops.py hook.py install.py restore.py platform_lock.py platform_process.py
python -m pip install pyinstaller
python scripts/build_helpers.py
npm start
```

Create a Windows NSIS installer on Windows:

```powershell
npm run package:win
```

Create a Linux AppImage on Linux:

```bash
npm run package:linux
```

GitHub Actions runs JavaScript and Python tests on Linux and Windows, builds the standalone bridge and hook for that OS, and smoke-tests the packaged Electron window. Tagged releases build a Windows x64 installer and Linux x64 AppImage. CI smoke tests do not verify Codex sign-in, live App Server compatibility, or real-user installation behavior.

## Compatibility

- Desktop app: Windows 10+ x64 and 64-bit Linux x64, with Codex CLI available on `PATH` and signed in.
- GNOME panel extension: Fedora and GNOME Shell 50.
- macOS, ARM64, and 32-bit builds are out of scope for the initial desktop packages.

See [`docs/superpowers/specs/2026-10-09-rr-island-linux-windows-design.md`](docs/superpowers/specs/2026-10-09-rr-island-linux-windows-design.md) for planned cross-platform improvements and release gates.
