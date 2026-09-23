# Exegol — Release & Distribution Guide

## Current State

- **Build config**: `apps/desktop/electron-builder.ts` (macOS DMG/ZIP, Windows NSIS, Linux AppImage)
- **Auto-updater**: `apps/desktop/src/main/system/auto-updater.ts` (electron-updater, GitHub Releases, feed `dPeluChe/exegol`)
- **Icons**: `apps/desktop/src/resources/build/icons/` (icns, ico, png)
- **Version**: `apps/desktop/package.json` says `0.4.1` (git tag `v0.4.1`), but `docs/CHANGELOG.md` already lists 0.4.2, 0.4.3 and 0.4.4 as released. Reconcile before cutting a DMG (step 2).
- **Signing**: `notarize: false`, no signing identity configured. Builds are unsigned.

## Steps to First Release

### 1. Prerequisites

```bash
# Verify build tools
bun --version          # 1.2+
node --version         # 20+ (root engines; CI uses 22; esbuild EPIPE issue on Node 23)
cargo --version        # For core-rust native module
```

### 2. Reconcile the version

`apps/desktop/package.json` (0.4.1) and `docs/CHANGELOG.md` (latest released 0.4.4, plus the Unreleased sections above it) disagree. Pick the next version above 0.4.4, set it in `apps/desktop/package.json`, and rename the CHANGELOG Unreleased sections to that version before packaging. The DMG file name and the auto-update manifest both take the version from `package.json`.

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

Output: `apps/desktop/dist/Exegol-<version>-<arch>.dmg` (name from `DMG_NAME` in `electron-builder.ts`), plus the `-mac.zip` and `latest-mac.yml`.

### 4. Install and first launch (unsigned build)

Open the DMG and drag Exegol to Applications. The app is not signed or notarized, so Gatekeeper blocks a double-click on first launch: right-click Exegol in Applications and choose Open, then confirm. A DMG downloaded from GitHub also carries the quarantine flag; clear it with `xattr -dr com.apple.quarantine /Applications/Exegol.app` if Open is not offered.

### 5. Enable macOS Code Signing (for distribution)

In `electron-builder.ts`, change:
```typescript
notarize: true,  // ← change from false
```

Required environment variables (set in CI or local):
```bash
export CSC_LINK="base64-encoded-p12-certificate"
export CSC_KEY_PASSWORD="certificate-password"
export APPLE_ID="your@apple.id"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # Generate at appleid.apple.com
export APPLE_TEAM_ID="XXXXXXXXXX"
```

### 6. Publish to GitHub Releases

```bash
# Version set in step 2, package built in step 3
cd apps/desktop

# Create GitHub Release (manual for now, T45 automates this).
# Existing tags use the vX.Y.Z form; the updater reads releases/latest, so the tag name is free.
gh release create v0.5.0 \
  dist/Exegol-0.5.0-arm64.dmg \
  dist/Exegol-0.5.0-arm64-mac.zip \
  dist/latest-mac.yml \
  --title "Exegol v0.5.0" \
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
