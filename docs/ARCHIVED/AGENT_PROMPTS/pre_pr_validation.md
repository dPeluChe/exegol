# Pre-PR Validation — Final Gate

> Use after the agent has completed the quality review and applied corrections.
> Goal: confirm everything compiles, lint passes clean, and files are in order before creating the PR.

---

We are about to create the PR. Run the full validation suite.

## 1. Lint — must report 0 errors AND 0 warnings

```bash
npx @biomejs/biome check apps/ packages/shared/src/ packages/ui/src/
```

If there are errors, fix them with:
```bash
npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/
```

Run the check again after fixing to confirm 0 errors, 0 warnings.

## 2. TypeScript — must compile without errors

```bash
npx tsc --noEmit -p apps/desktop/tsconfig.node.json
npx tsc --noEmit -p apps/desktop/tsconfig.web.json
```

If there are type errors, fix them. **Do NOT use `@ts-ignore` or `any` as an escape hatch.**

## 3. Rust (only if you modified packages/core-rust/)

```bash
cd packages/core-rust && cargo check
```

## 4. Import verification
- No unused imports
- No unused variables (linter will flag these)
- Verify you are not importing from relative paths that should be `@exegol/shared` or `@exegol/ui`

## 5. File verification

```bash
# Check for unexpected files
git status

# Confirm you only touched files in your cluster
git diff --stat main...HEAD
```

- Must not contain: temporary console.log statements, .bak files, debug files
- If you modified files outside your assigned list, justify why

## 6. Commits
- Each task must have its own descriptive commit
- Format: `feat: T{XX} — {short description of what was implemented}`
- Do not squash everything into a single commit
- Verify with `git log --oneline main...HEAD`

## 7. Expected output

Show me the output of:
1. `npx @biomejs/biome check apps/ packages/shared/src/ packages/ui/src/` → 0 errors, 0 warnings
2. `npx tsc --noEmit -p apps/desktop/tsconfig.node.json` → clean
3. `npx tsc --noEmit -p apps/desktop/tsconfig.web.json` → clean
4. `git log --oneline main...HEAD` → one commit per task
5. `git diff --stat main...HEAD` → only files from this cluster

If everything passes clean, we proceed to create the PR.
