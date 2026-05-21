# Exegol Release Checklist

Quick reference for cutting a new release. Follow top-to-bottom; nothing here
should take more than 10 minutes once the prereqs are in place.

## Prereqs (one-time)
- [ ] Apple Developer credentials configured in env (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) for notarization
- [ ] `GH_TOKEN` env var with `repo` scope (publish to `dPeluChe/exegol` releases)
- [ ] `electron-builder` recognizes the signing cert in macOS Keychain (`security find-identity -v -p codesigning`)
- [ ] Flip `mac.notarize` to `true` in `apps/desktop/electron-builder.ts` when credentials land

## Per-release flow

### 1. Pre-flight checks (5 min)
- [ ] `git status` clean on `main`
- [ ] `bun run typecheck` clean
- [ ] `npx @biomejs/biome check apps/ packages/shared/src/ packages/ui/src/` clean
- [ ] `cd packages/core-rust && cargo test && cargo clippy` clean
- [ ] `bun run test` all suites green
- [ ] Bump `apps/desktop/package.json` version (semver)
- [ ] Update `docs/CHANGELOG.md` with the version + highlights

### 2. Build (5-10 min)
- [ ] `bun run build` from repo root — produces `apps/desktop/out/`
- [ ] `cd apps/desktop && bun run package:mac` — produces `apps/desktop/dist/Exegol-<version>-arm64.dmg`
- [ ] Smoke-launch the packaged DMG: open, click around the basic UX (spawn an agent, open settings, switch tabs)

### 3. Channel & publish
- [ ] **Stable channel**: tag commit `vX.Y.Z`, push tag, run `bun run package:mac -- --publish always`
- [ ] **Canary channel**: tag commit `vX.Y.Z-canary.N`, push, then `bun run package:mac -- --publish always --config.publish.channel=canary`

`electron-builder` auto-uploads to GitHub Releases under the configured owner/repo
(`dPeluChe/exegol`). It writes `latest.yml` (or `latest-canary.yml`) which the
`electron-updater` clients use as their feed.

### 4. Verify auto-update (5 min)
- [ ] Install a previous version DMG on a clean Mac VM (or a second machine)
- [ ] Launch it, check Settings → "Check for updates"
- [ ] Confirm it downloads + installs the new version
- [ ] For canary builds: launch the app with `EXEGOL_UPDATE_CHANNEL=canary` and confirm canary feed is used

### 5. Post-release
- [ ] Mark the GitHub release as "Latest release" (stable only — leave canary as pre-release)
- [ ] Move any TASK_TODO entries shipped in this version to `docs/tasks_completed/YYYY_MM.md`
- [ ] Announce in whatever the team channel is

## Channel separation

| Channel | Tag format | Audience | Update feed |
|---|---|---|---|
| stable | `vX.Y.Z` | end users | `latest.yml` |
| canary | `vX.Y.Z-canary.N` | dogfood | `latest-canary.yml` |

The canary channel is automatic in `electron-builder`'s `generateUpdatesFilesForAllChannels: true` (already set in `electron-builder.ts`). The `electron-updater` client picks the channel based on the running app's pre-release suffix.

## When something goes wrong

- **Notarization fails**: check `~/Library/Logs/electron-builder/` for the Apple response. Most common: missing entitlements or bundle ID mismatch.
- **Auto-update doesn't fire**: confirm `latest.yml` is on the release, version in app is strictly less than release version, and `publish.owner`/`publish.repo` match the actual GitHub repo (`dPeluChe/exegol`).
- **DMG opens but Rust native crashes**: check `extraResources` block in `electron-builder.ts` is shipping the `.node` binary for the target arch — see `process.resourcesPath/core-rust` fallback in `apps/desktop/src/main/agents/spawn-env.ts`.
