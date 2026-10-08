# RR-Island

RR-Island is a GNOME Shell companion for Codex. It brings local activity, an animated pet, Mini chat, and account usage into a compact OLED-style panel.

## Features

- **Live activity and pet** — shows Codex activity and animates Rakit according to the current state and motion preferences.
- **Mini chat** — streams replies, keeps drafts per chat for the current session, and can continue conversations already in Codex history.
- **Chat navigation** — search and pin chats locally, copy drafts or replies, and open a conversation in the Codex desktop app.
- **Usage overview** — displays available account usage without background polling.
- **Panel preferences** — tune position, size, motion, and keyboard behavior.

## Requirements

- Fedora Linux with GNOME Shell 50
- A signed-in Codex desktop app or CLI session
- Python 3
- Node.js 22 or later to run the JavaScript test suite

RR-Island uses the existing Codex session and its account limits. It does not require an API key or a separate paid service.

## Install

Review `install.py` before running it. The installer copies the extension and helper, enables the extension in the current GNOME session, and adds a status hook to the Codex configuration. Back up any existing Codex hook configuration first.

```bash
python3 install.py
```

On Wayland, log out and back in normally after changing extension code so GNOME loads the new version. To restore the most recent configuration backup, review `restore.py` and run it:

```bash
python3 restore.py
```

If Codex asks, review and trust the installed local hook. The hook records tool status and the local project name; it does not record prompts or reply contents. Mini communicates with the Codex App Server over a local pipe. Mini chat uses a read-only tool sandbox. Existing chats follow the permissions already stored by Codex; requests that need tool approval must be continued in the main Codex app.

When the Mini working-directory preference is empty, RR-Island uses the user's home directory. Drafts stay in memory for the current session and are not written to files.

## Development

Run the automated tests and Python syntax checks locally:

```bash
npm test
python3 -m py_compile bridge.py file_ops.py hook.py install.py restore.py
```

Pull requests and pushes to `main` run the same checks in GitHub Actions. The automated tests cover the JavaScript models and pet/usage behavior; they do not replace testing in a live GNOME session.

## Compatibility

This release targets GNOME Shell 50. Runtime behavior should be verified on the target Fedora/GNOME session after installation, especially following shell or Codex app updates.
