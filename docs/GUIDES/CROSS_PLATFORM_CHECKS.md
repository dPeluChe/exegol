# Cross-platform checks

What only a real Windows or Linux desktop can confirm; what a runner can check lives in `apps/desktop/src/main/system/os-contract.test.ts`. Run it on each full build. A test build needs
no release: run `windows.yml` or `linux.yml` by hand with `test` on, and the package is kept as a run
artifact.

## Windows 11

- Terminal links: `C:\repo\a.ts:12`, `src\a.ts`, `~\.exegol`, `C:/repo/a.ts` open; `\\server\share` stays text
- A file dragged onto a terminal, from a folder with a space
- Launcher in a subfolder: the sessions list, Editor button, Terminal in that folder
- Close and resume a shell: it reopens in its last folder
- Files pane: New file on a file, rename, the tree opens down to the open file
- Pipeline and Race runs: the worktree is removed afterwards
- Two Codex or Gemini sessions in one folder: each sees its own MCP identity
- Devin's chat in Company, Claude's transcript chat, Goose history
- AI commit message without an API key (`claude -p`), model lists in the launcher
- Skills: `~/.agents/skills` links appear with no admin rights and no Developer Mode
- Task board on a repo with `core.autocrlf=true`, toggling a task keeps CRLF
- Repo hooks in `.exegol/lifecycle.yaml`, in pwsh and in Windows PowerShell 5.1, which has no `&&`
- No console window flashes during normal use
- Notifications carry the app's name and a click opens it; taskbar icon groups with the shortcut
- Install an update with sessions open: it finishes, and the sessions come back for resume
- Resources: agent memory and disk read real numbers; Storage shows worktree sizes
- JetBrains IDE through Toolbox is detected, VS Code too
- A safe test of the command guard: a hook with `rd /s /q C:\` is refused

## Linux (AppImage, deb, rpm)

- deb and rpm install `lsof`; port chips and the dev server list work
- A printed `/mnt/...` or gvfs path never hangs the terminal
- Lock the keyring, or log in without it: API keys read as missing, never as garbage
- Doctor on Wayland shows the limits; floating panes; global hotkey
- AppImage on Ubuntu 24+ (user namespaces); whether its `LD_LIBRARY_PATH` reaches terminals
- Dictation in AppImage and deb (sherpa)

## Unknown until run

- Whether Devin's `sessions.db` sits under `%APPDATA%\devin\cli` (from a third-party guide)
- Goose's Windows folder (`%APPDATA%\Block\goose\data\sessions`, from memory of its docs)
- Windows credential folders in `path-guard.ts`
- Factory Droid's session folder rule on Windows (`droid.ts`, unchanged)
- Which shell runs the Codex hooks on Windows (`wrappers.ts`)
- Whether digit keys answer Devin's picker
