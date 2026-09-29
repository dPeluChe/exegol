# Exegol — Release & Distribution Guide

## Current State

- **Build config**: `apps/desktop/electron-builder.ts` (macOS DMG/ZIP, Windows NSIS, Linux AppImage)
- **Auto-updater**: `apps/desktop/src/main/system/auto-updater.ts` (electron-updater, GitHub Releases, feed `dPeluChe/exegol`)
- **Icons**: `apps/desktop/src/resources/build/icons/` (icns, ico, png)
- **Version**: `0.5.0` in `apps/desktop/package.json` and `docs/CHANGELOG.md` (0.4.2-0.4.4 were CHANGELOG-only; the last tag is `v0.4.1`).
- **Signing**: builds are signed with the Developer ID Application certificate in the login keychain
  (team `NQHHJ85736`, found automatically) and hardened runtime. **Notarized only when
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

### 4. Install and first launch (unsigned build)

Open the DMG and drag Exegol to Applications. The app is not signed or notarized, so Gatekeeper blocks a double-click on first launch: right-click Exegol in Applications and choose Open, then confirm. A DMG downloaded from GitHub also carries the quarantine flag; clear it with `xattr -dr com.apple.quarantine /Applications/Exegol.app` if Open is not offered.

### 5. Notarize (required for anything downloaded)

A signed but not notarized app gets "Apple could not verify Exegol is free of malware" when it
came from the internet (GitHub, Slack...). Notarization needs Apple credentials once per machine:

1. At appleid.apple.com → Sign-In and Security → App-Specific Passwords, create one ("exegol-notary").
2. Store it in the keychain (run it yourself: it asks for the password, never put it in a file):
   ```bash
   xcrun notarytool store-credentials exegol-notary \
     --apple-id <your Apple ID email> --team-id NQHHJ85736
   ```
3. Build with the profile; electron-builder signs, submits, waits and staples:
   ```bash
   APPLE_KEYCHAIN_PROFILE=exegol-notary bun run package:mac
   ```
4. electron-builder notarizes and staples the **app**, not the DMG. Sign, notarize and staple the
   DMG too (a downloaded DMG then opens clean, offline included):
   ```bash
   cd apps/desktop/dist/<v>
   codesign --force --timestamp --sign "Developer ID Application: jose antonio martinez quintero (NQHHJ85736)" Exegol-<v>-arm64.dmg
   xcrun notarytool submit Exegol-<v>-arm64.dmg --keychain-profile exegol-notary --wait
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
