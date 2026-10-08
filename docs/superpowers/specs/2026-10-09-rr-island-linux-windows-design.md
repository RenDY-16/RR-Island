# RR-Island Linux and Windows Design

## Goal

Make RR-Island available as an installable desktop companion on mainstream Linux desktops and Windows, without asking end users to clone the source repository or install Node.js. Keep the existing GNOME panel extension available as an optional GNOME integration.

## User intent and constraints

- The supported operating-system families are Linux and Windows only. macOS is out of scope.
- RR-Island should be freely modifiable and redistributable under the MIT License.
- End users should download a ready-to-run package from GitHub Releases; `npm install` is for development, not the end-user installation path. Packages must not require a separately installed Node.js or Python runtime.
- The project must continue to use the user's existing local Codex sign-in and usage entitlement. Do not add an API key requirement, remote service, or recurring paid dependency.
- Users need a locally installed Codex CLI or desktop app that exposes the Codex App Server interface; RR-Island does not bundle Codex itself.
- The main experience should retain the current activity, pet, Mini chat, usage, and settings features where the platform supports them.
- GNOME-specific panel placement and extension APIs cannot be assumed on other Linux desktops or Windows.

## Recommended architecture

Build an Electron desktop application as the cross-platform RR-Island shell. Its main window provides the Island UI, pet, activity, Mini chat, usage view, and preferences. A tray entry may open or focus this window where the desktop supports it; the launcher and main window remain the reliable entry point. Electron's Chromium and Node.js runtimes are bundled with release builds, so end users do not need Node.js installed.

Keep the existing GNOME Shell extension as an optional, separate GNOME integration that retains its current panel experience. The Electron app is the portable entry point on Windows and Linux desktops without GNOME. The Electron UI independently implements the same core features; framework-independent model code should be reused where practical, while GJS widgets and GNOME APIs remain confined to the GNOME extension.

### Review findings that are release blockers

- **Windows bridge port:** the current Python bridge and hook rely on Linux-only `fcntl` locks, process-group signaling, and session creation. The installer also calls GNOME tools such as `gsettings` and `glib-compile-schemas` and assumes `/usr/bin/python3`. The Windows build must use platform-specific locking, process lifecycle, paths, and packaging, and must not invoke GNOME setup. A passing Windows CI run is required before claiming Windows support.
- **Codex process boundary:** define a typed request/response protocol between Electron's main process and the bundled bridge, including Codex executable discovery, authentication/App Server availability checks, launch and shutdown behavior, request timeouts, and restart/error reporting. Keep process spawning in the main process and expose only narrow validated operations to the renderer. Test the lifecycle against a fake Codex process on both operating systems.
- **Hook ownership and recovery:** replace substring-based hook removal and whole-file restore with explicit RR-Island ownership metadata and atomic, merge-based updates. Back up the original file, preserve unrelated hooks, and on repair/uninstall remove only entries marked as owned by RR-Island. Tests must cover third-party entries, malformed configuration, interrupted writes, and restoring only RR-Island's changes.
- **Asset provenance:** the project owner confirms `extension/assets/rakit.png` and the RR-Island SVG icon are original assets owned by them and may be distributed under this project's MIT License. Record this in `ASSET-LICENSES.md`.

Move platform-specific process handling and filesystem operations behind a small platform adapter. The Codex App Server connection remains local over standard input/output. Port process discovery, state paths, process termination, locking, and hook installation so Linux and Windows use native paths and behavior. Keep status hooks limited to activity metadata; do not store prompts or response text.

## Feature improvements requested for the cross-platform app

- **Reliable Codex bridge:** add fake-Codex process/RPC coverage for disconnects, timeouts, accepted sends with late acknowledgements, interrupts, shutdown, concurrent requests, and old-chat sends. These tests must run in CI without a signed-in Codex account.
- **Old-chat permission clarity:** before sending to a selected historical chat, show that RR-Island follows that chat's saved permissions and does not override them. If permission details are unavailable, say so explicitly and offer to open the chat in Codex.
- **Screenshot to chat:** let the user capture the full screen or select an area, preview it, confirm the destination chat, then send it as an image. Prefer memory-only transfer. If the Codex App Server protocol requires a temporary file, create it with private permissions and delete it immediately after the send attempt. Do not silently fall back to text-only or claim success if image input is unsupported.
- **Connection diagnosis:** distinguish common failures such as missing Codex executable, sign-in needed, unsupported protocol, disconnected process, and busy chat. Provide a user-triggered copyable report with prompts, tokens, conversation content, and full personal paths excluded.
- **Pet selection:** allow choosing among valid local pet assets and previewing the choice. An optional “follow Codex pet” mode may use only a supported, user-readable source; otherwise explain that the mode is unavailable.
- **Small-screen Mini:** adapt width and height to the available screen, support keyboard-first use, and render links and code blocks safely with a copy action. Escape untrusted model text rather than rendering arbitrary markup.
- **Safe uninstall and repair:** preview the RR-Island hook changes, back up the current configuration, remove only RR-Island-owned hook entries, and preserve hooks owned by other tools. Do not remove another agent's hooks automatically.
- **Public release readiness:** include versioned changelog/release notes, tested compatibility facts, troubleshooting steps, and a bug-report template. Report only platform and Codex versions actually exercised.

Implement the improvements in dependency order: bridge tests and diagnostics first; old-chat permission clarity; screenshot transfer after protocol capability is verified; Mini and pet usability; safe uninstall; then the public packages. The same behavior should be available in the Electron app and the GNOME integration where the host APIs permit it.

## Installation and releases

- Publish a Windows x64 installer (`.exe`) and a portable Linux x64 AppImage as GitHub Release assets. End users download the asset for their OS and install/run it without cloning the repository.
- Bundle RR-Island's Python bridge and status-hook helpers as platform-specific executables inside each release package; Codex CLI remains a user-installed prerequisite.
- Build artifacts from version tags using GitHub Actions and run automated tests before publishing.
- Add a Flatpak distribution only after the initial direct-download packages are verified; Flathub submission is outside the first milestone.
- Keep `npm install` and development commands documented for contributors only.
- ARM64 support may be added after x64 packages and Codex integration pass platform testing; it is not part of the first milestone.

## Compatibility target

- Windows 10 or later, x64, using a currently supported Electron release.
- Mainstream 64-bit Linux desktop distributions using glibc. Initial release testing must include Fedora and Ubuntu. Other distributions are best-effort until tested.
- 32-bit Linux, Alpine/musl, headless systems, WSL, macOS, and mobile operating systems are out of scope.
- Linux window-manager and desktop-shell features vary. The portable app must remain usable without GNOME; panel insertion is optional and GNOME-specific.

## Security and privacy

- Use Electron context isolation, a sandboxed renderer, and a narrow preload API. The renderer must not receive unrestricted Node.js or shell access.
- Keep Codex communication local. Do not add an external server or require an API key.
- Preserve Mini's read-only tool sandbox and its current policy of declining unsupported approval requests.
- Preserve current bounded local storage behavior and avoid persisting drafts, screenshots, or conversation contents beyond the existing Codex storage. A screenshot may exist in a private temporary file only when the protocol requires one, and must be deleted after the send attempt.
- Installer, repair, and uninstall flows must back up existing Codex hook settings and only remove or replace RR-Island's own entries using atomic, merge-based writes.

## Licensing

Add the standard MIT License at the repository root, naming `RenDY-16` as the copyright holder, so users may modify and redistribute the project while retaining the copyright and license notice.

## Verification

- Unit tests cover platform path resolution and process handling, Codex executable discovery and App Server readiness, status-hook payload handling, fake-Codex IPC/RPC lifecycle behavior, permission-state messaging, image-send capability handling, diagnostics redaction, and hook configuration merge/restore behavior on Linux and Windows.
- CI runs unit tests on Linux and Windows and builds release artifacts for both operating-system families.
- A manual release checklist verifies installation, launch, Codex connection, Mini chat, usage refresh, preferences, upgrade, and uninstall on Fedora, Ubuntu, and Windows.
- Automated builds do not claim that live GNOME panel integration, Windows behavior, or Codex authentication is verified until checked on those real environments.

## Out of scope for the first milestone

- macOS support.
- Publishing to Flathub or GNOME Extensions.
- Auto-update service, package-manager repositories such as winget, dnf, or apt, and paid code-signing services.
- 32-bit, ARM64, or musl Linux support.
- Changing Codex's account, authentication, billing, or usage-limit behavior.
