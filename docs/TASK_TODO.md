# Exegol — Task Board

> **Quality gate before PR**:
> - `npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/`
> - `npx tsc --noEmit -p apps/desktop/tsconfig.node.json && npx tsc --noEmit -p apps/desktop/tsconfig.web.json`
> - Max 400-500 LOC per file

---

## Distribution (pending GitHub)

### T45 — CI/CD Release Pipeline
**Priority**: Medium — activate when repo goes to GitHub

1. Push repo to GitHub
2. Configure secrets: MAC_CERTIFICATE, APPLE_ID, APPLE_TEAM_ID
3. Update GITHUB_OWNER/REPO in auto-updater.ts and electron-builder.ts
4. Enable notarize: true

**Acceptance**:
- [ ] `build-desktop.yml`: macOS (arm64 + x64) + Linux (x64)
- [ ] `release-desktop.yml`: triggered by `desktop-v*` tags
- [ ] `create-release.sh`: bump version, create tag, push
- [ ] macOS code signing + notarization
- [ ] Release notes from conventional commits

### T46 — Canary Channel (optional)
**Priority**: Low

- [ ] Separate app ID + canary icons
- [ ] Scheduled builds every 12h
- [ ] Rolling `desktop-canary` tag

---

## UX Polish (pending)

| Item | Description | Priority |
|------|-------------|----------|
| GitPane worktree stage/commit | Add stage/commit/push actions for worktree paths (currently view-only) | Medium |
| FOREIGN KEY scoring error | Race condition: agent deleted before scoring completes on exit | Low |
| napi-rs deprecation warnings | Update napi.name → napi.binaryName, napi.triples → napi.targets | Low |

---

## Completed

V1 (T01-T16), V2 (T17-T34), V3 (T35-T55): 55+ tasks complete.
See `docs/tasks_completed/2026_03.md` for full log.
