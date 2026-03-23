# Exegol — Release & Distribution Guide

## Current State

- **Build config**: `apps/desktop/electron-builder.ts` (macOS DMG/ZIP, Windows NSIS, Linux AppImage)
- **Auto-updater**: `apps/desktop/src/main/system/auto-updater.ts` (electron-updater, GitHub Releases)
- **Icons**: Placeholder in `apps/desktop/src/resources/build/icons/` (replace with final design)
- **Version**: `apps/desktop/package.json` → `"version": "0.1.0"`

## Steps to First Release

### 1. Prerequisites

```bash
# Verify build tools
bun --version          # 1.2+
node --version         # 20 LTS recommended (esbuild EPIPE issue on Node 23)
cargo --version        # For core-rust native module
```

### 2. Replace Placeholder Icons

Replace these files with the final Exegol icon design:
- `apps/desktop/src/resources/build/icons/icon.png` — 1024x1024 PNG (used for Linux + source)
- `apps/desktop/src/resources/build/icons/icon.icns` — macOS icon (generate from PNG via `iconutil`)
- `apps/desktop/src/resources/build/icons/icon.ico` — Windows icon (generate from PNG via tools like `png2ico`)

### 3. Update GitHub Config

In `apps/desktop/src/main/system/auto-updater.ts`:
```typescript
const GITHUB_OWNER = "your-org";    // ← replace
const GITHUB_REPO = "exegol";       // ← replace
```

In `apps/desktop/electron-builder.ts`:
```typescript
publish: {
  provider: "github",
  owner: "your-org",     // ← replace
  repo: "exegol",        // ← replace
},
```

### 4. Local Build Test

```bash
cd apps/desktop

# Build the Electron app (compile TS → JS)
bun run build

# Package for current platform (creates DMG/exe/AppImage in dist/)
bun run package

# Platform-specific:
bun run package:mac
bun run package:win
bun run package:linux
```

Output: `apps/desktop/dist/Exegol-0.1.0-arm64.dmg` (or equivalent)

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
# Bump version
cd apps/desktop
# Edit package.json version to desired number (e.g., "0.2.0")

# Build + package
bun run package:mac

# Create GitHub Release (manual for now, T45 automates this)
gh release create desktop-v0.2.0 \
  dist/Exegol-0.2.0-arm64.dmg \
  dist/Exegol-0.2.0-arm64-mac.zip \
  dist/latest-mac.yml \
  --title "Exegol v0.2.0" \
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

## Future: CI/CD Pipeline (T45)

When ready to automate:
1. Create `.github/workflows/build-desktop.yml` (reusable build)
2. Create `.github/workflows/release-desktop.yml` (tag-triggered release)
3. Create `apps/desktop/create-release.sh` (interactive release script)
4. Configure GitHub repository secrets for code signing
5. Tag `desktop-v0.x.0` → workflow builds → draft release → review → publish

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
