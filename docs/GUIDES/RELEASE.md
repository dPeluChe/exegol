# Exegol — Release & Distribution Guide

## Current State

- **Build config**: `apps/desktop/electron-builder.ts` (macOS DMG/ZIP, Windows NSIS, Linux AppImage)
- **Auto-updater**: `apps/desktop/src/main/system/auto-updater.ts` (electron-updater, GitHub Releases, feed `dPeluChe/exegol`)
- **Icons**: `apps/desktop/src/resources/build/icons/` (icns, ico, png)
- **Version**: `apps/desktop/package.json` and the matching heading in `docs/CHANGELOG.md`.
- **Signing**: builds are signed with the Developer ID Application certificate in the login keychain
  (found automatically; list it with `security find-identity -v -p codesigning`) and hardened runtime. **Notarized only when
  `APPLE_KEYCHAIN_PROFILE` is set** (step 5); without it a downloaded DMG is refused by Gatekeeper.

## Steps to First Release

### 1. Prerequisites

```bash
# Verify build tools
bun --version          # 1.2+
node --version         # 20+ (root engines; CI uses 22; esbuild EPIPE issue on Node 23)
cargo --version        # For core-rust native module
```

### 2. Set the version

Bump `apps/desktop/package.json` and rename the CHANGELOG `[Unreleased]` sections to that version before packaging. The DMG file name and the auto-update manifest both take the version from `package.json`.

### 3. Local build

Run from the repo root:

```bash
bun install
bun run build:rust       # core-rust .node, copied into the app via extraResources
bun run rebuild:native   # node-pty against Electron 41

bun run package:mac      # electron-vite build + electron-builder (also runs the build step)
# other platforms: bun run package:win / bun run package:linux
```

Skipping `build:rust` ships no `.node` file and the app falls back to the JS output path.

Output: `apps/desktop/dist/<version>/Exegol-<version>-<arch>.dmg` (one folder per version) (name from `DMG_NAME` in `electron-builder.ts`), plus the `-mac.zip` and `latest-mac.yml`.

#### Post-build cleanup

Each `package*` script has a `postpackage*` script, `bun run clean:build -- --apply --repo-only`
(`apps/desktop/scripts/clean-build.ts`). Bun runs it only when packaging succeeded, and flags given
to packaging still go to electron-builder only (`bun run package:mac -- -c.directories.output=...`
behaves as before). It always exits 0, so it never fails a build. It removes only:

| Target | Rule | Why |
|--------|------|-----|
| `apps/desktop/dist/<version>/` | keeps the newest 2 by semver (`--keep N`), the version in `package.json` always among the kept (older ones live in GitHub releases) | each folder is ~750 MB of DMG + zip |
| `apps/desktop/dist/<version>-local*/` | keeps the newest by date | local test builds |
| `.turbo/cache/<hash>*` | all files of a hash older than 14 days (`--days N`) | the local turbo cache never shrinks |
| `packages/core-rust/target/*/incremental/<crate>-<hash>/` | older than 14 days, skipped while cargo runs | cargo keeps a dir per flag/toolchain set |
| `$TMPDIR/exegol-<test prefix>-XXXXXX/` | older than a day; only the test suites' mkdtemp prefixes | tests leave thousands behind (skipped with `--repo-only`) |

A dist folder whose DMG is mounted (`hdiutil info`, macOS only), that a running process uses
(Exegol.app opened from `dist`, `ps`), or with an open file (`lsof +D`) is skipped, never detached;
each check has a 10 s timeout and a failed check skips the folder. On Linux there is no DMG check
(ps and lsof still apply; without lsof every dist folder is skipped). On Windows dist cleanup is a
no-op (no ps/lsof). Nothing runs unless the `package.json` version parses; an error on one path is
logged as `skip (error: ...)` and the rest continues. It never touches `node_modules`, `apps/desktop/out`, the rest
of `target/`, or anything under `~/.exegol` or the app data folder; the electron and
electron-builder download caches are only reported (other Electron projects share them).

Dry run (prints each path and size, removes nothing): `bun run clean:build`. Then
`bun run clean:build -- --apply`, which also removes the old test temp dirs and orphaned
worktrees (never in the postpackage run).

#### Orphaned worktrees

One rule everywhere (`main/lib/worktree-safety.ts`, `worktreeSafety`). Git runs with every
`GIT_*` variable removed from the environment and `-c status.showUntrackedFiles=all`, so no user
setting hides a file. A worktree may go only when all of these hold; otherwise it is reported and
kept, and branches are never deleted:

1. git answers for that folder itself (`rev-parse --show-toplevel` is the folder)
2. no `.gitmodules`
3. no operation in progress: none of `rebase-merge`, `rebase-apply`, `MERGE_HEAD`,
   `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG` exists at its `git rev-parse --git-path`
4. `git status --porcelain --untracked-files=all --ignore-submodules=none --ignored=matching`
   lists nothing but `.agents/mcp_config.json` and ignored build output: `node_modules`, `dist`,
   `out`, `build`, `.turbo`, `target`, `.next`, `coverage`, `.vite`, `.cache`, `*.log`,
   `.DS_Store` (any other ignored file, such as `.env` or a local database, keeps it)
5. `git rev-list --count HEAD --not --remotes` is 0: every commit is pushed or already in
   origin/main
6. not locked (`git worktree list --porcelain`)

- `clean:build` worktrees section (explicit runs only, never the postpackage run):
  `git worktree prune` (dry run: `--dry-run -v`), then each `.claude/worktrees/agent-*` of the
  main checkout whose branch's PR is merged or closed with none open (`gh pr list --head <branch>
  --state all`; gh missing or offline keeps it). A folder that is not a registered worktree is
  reported, never removed. Also kept: the main checkout, the checkout running the script, and a
  folder that is the cwd of a running process (`lsof -a -d cwd -Fn`; lsof failing keeps all).
  Removal: `git checkout -- .agents/mcp_config.json`, then a plain `git worktree remove` (no
  `--force`, so git checks again; 120 s timeout), then a Finder `.DS_Store` and the empty folder.
- The app, in the daily housekeeping (`main/system/worktree-housekeeping.ts`), over
  `~/.exegol/worktrees` and `~/.exegol/pipelines`, for repos that are registered projects:
  - a `worktrees` row whose folder is gone: row dropped, the repo's registrations pruned
  - a row whose agents are all archived, the last over a day ago (or with no agent, created over
    a day ago), and a folder with no row whose `.git` is over a day old: removed under the rule
  - never while an agent is live in it, a session can still be resumed into it (stopped, crashed
    or suspended and not archived), an active pipeline (pending, running, paused) has its path,
    or a race is running or completed with no pick yet
  - removal: the path joins `removingWorktrees` (a spawn never reuses it meanwhile), the
    live-agent check runs again, the folder is renamed to `.exegol-trash-<name>-<ts>` beside it,
    `git worktree prune`, then the trash is deleted off the main thread (a later sweep finishes a
    trash left behind). One summary log line, no paths

The app also sweeps per-agent files once a day, at startup and then daily while open
(`main/system/housekeeping.ts`): `~/.exegol/hooks/<id>.json`, `~/.exegol/mcp/<id>.json` and
`~/.exegol/model-settings/<id>.json` older than a day whose agent id is not in the database. It
skips when the orphaned ids outnumber twice the known ones (a reset or swapped database). Agent
history (terminal scrollback) is never removed.

### 4. Install and first launch (unsigned build)

Open the DMG and drag Exegol to Applications. The app is not signed or notarized, so Gatekeeper blocks a double-click on first launch: right-click Exegol in Applications and choose Open, then confirm. A DMG downloaded from GitHub also carries the quarantine flag; clear it with `xattr -dr com.apple.quarantine /Applications/Exegol.app` if Open is not offered.

### 5. Notarize (required for anything downloaded)

A signed but not notarized app gets "Apple could not verify Exegol is free of malware" when it
came from the internet (GitHub, Slack...). Notarization needs Apple credentials once per machine:

1. At appleid.apple.com → Sign-In and Security → App-Specific Passwords, create one (any label).
2. Store it in the keychain (run it yourself: it asks for the password, never put it in a file):
   ```bash
   xcrun notarytool store-credentials <profile> \
     --apple-id <your Apple ID email> --team-id <TEAMID>
   ```
3. Build with the profile; electron-builder signs, submits, waits and staples:
   ```bash
   APPLE_KEYCHAIN_PROFILE=<profile> bun run package:mac
   ```
4. electron-builder notarizes and staples the **app**, not the DMG. Sign, notarize and staple the
   DMG too (a downloaded DMG then opens clean, offline included):
   ```bash
   cd apps/desktop/dist/<v>
   codesign --force --timestamp --sign "Developer ID Application: <Your Name> (<TEAMID>)" Exegol-<v>-arm64.dmg
   xcrun notarytool submit Exegol-<v>-arm64.dmg --keychain-profile <profile> --wait
   xcrun stapler staple Exegol-<v>-arm64.dmg
   ```
   Signing rewrites the DMG, so its `.blockmap` is stale: do not publish it (the macOS updater
   uses the zip and its blockmap).
5. Check before publishing, both must say `source=Notarized Developer ID`:
   `spctl -a -vv -t install mac-arm64/Exegol.app` and
   `spctl -a -vv -t open --context context:primary-signature Exegol-<v>-arm64.dmg`.

Until a build is notarized, a user can still open it: System Settings → Privacy & Security →
"Open Anyway" (on macOS 15 right-click → Open no longer offers it), or
`xattr -dr com.apple.quarantine /Applications/Exegol.app`.

### 5b. Linux (AppImage + .deb)

Native modules are built per platform, so Linux packages come from CI, not from the Mac:
`.github/workflows/linux.yml` runs on Ubuntu 22.04 (older glibc, wider distro reach) when a
release is published, builds core-rust and node-pty for Linux, packages an AppImage and a `.deb`,
and attaches them plus `latest-linux.yml` (auto-update for the AppImage) to that release. Rerun it
by hand from Actions → Linux build (optionally with a tag).

Install: `chmod +x Exegol-<v>-x86_64.AppImage && ./Exegol-<v>-x86_64.AppImage`, or
`sudo apt install ./exegol_<v>_amd64.deb`. Runtime needs: a desktop keyring (gnome-keyring or
kwallet) for encrypted API keys, and `lsof` for ports (the Doctor warns about both).

### 6. Publish to GitHub Releases

```bash
# Version set in step 2, package built in step 3
cd apps/desktop

# Create GitHub Release (manual for now, T45 automates this).
# Existing tags use the vX.Y.Z form; the updater reads releases/latest, so the tag name is free.
gh release create v0.5.1 \
  dist/0.5.1/Exegol-0.5.1-arm64.dmg \
  dist/0.5.1/Exegol-0.5.1-arm64-mac.zip \
  dist/0.5.1/latest-mac.yml \
  --title "Exegol v0.5.1" \
  --notes "Release notes here"
```

### 7. Auto-Update Flow

Once a release is published:
1. Running Exegol instances check `https://github.com/{owner}/{repo}/releases/latest/download/latest-mac.yml`
2. If version in manifest > current version → auto-download in background
3. User sees "Update ready — Restart to install" banner
4. On restart (or app quit) → update installs automatically

## Version Bumping Convention

```
0.x.y — pre-1.0 development
x.y.z — semver after 1.0
x.y.z-canary.YYYYMMDDHHmmss — canary builds (auto-detected by updater)
```

## CI checks

Pull requests and pushes to main run lint, TypeScript checks, tests, and builds through `.github/workflows/ci.yml`. See [Pipeline evidence and CI](PIPELINE_EVIDENCE_AND_CI.md) for commands and scope.

## Future: automated releases (T45)

`.github/workflows/ci.yml` already runs lint, typecheck, tests and `bun run build` on macOS. It does not package, sign or publish. When ready to automate releases:
1. Create `.github/workflows/build-desktop.yml` (reusable build)
2. Create `.github/workflows/release-desktop.yml` (tag-triggered release)
3. Create `apps/desktop/create-release.sh` (interactive release script)
4. Configure GitHub repository secrets for code signing
5. Tag `v0.x.0` → workflow builds → draft release → review → publish

## File Reference

| File | Purpose |
|------|---------|
| `electron-builder.ts` | Build targets, ASAR config, signing, publish |
| `src/resources/build/icons/` | App icons (icns, ico, png) |
| `src/resources/build/entitlements.mac.plist` | macOS security entitlements |
| `src/resources/build/entitlements.mac.inherit.plist` | Child process entitlements |
| `src/main/system/auto-updater.ts` | Update checker, downloader, installer |
| `src/renderer/components/common/UpdateBanner.tsx` | Update notification UI |
| `src/preload/index.ts` | `window.api.updater` bridge |
