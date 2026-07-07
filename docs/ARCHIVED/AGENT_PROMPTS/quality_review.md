# Quality Review — Post-Implementation

> Use when the agent reports that implementation is complete.
> Goal: ensure code meets project best practices before technical validation.

---

You have finished the implementation. Now perform a thorough quality review before proceeding to the PR.

## Review Checklist

### 1. Lines of Code per file (MAX 400-500)
- Review ALL files you created or modified
- If any file exceeds 400 LOC, split it into smaller modules
- UI components: extract sub-components if a file has more than 2 logical sections
- Business logic: separate queries, helpers, types into their own files

### 2. Reuse existing components
Verify you are using the components from `@exegol/ui` and `components/common/` that already exist:
- `EmptyState` — for empty states (do not create ad-hoc divs)
- `LoadingSpinner` — for loading states
- `StatusDot` — for status indicators
- `KeyValue` — for label/value pairs
- `ConfirmDialog` — for destructive action confirmations
- `SidebarSection` — for collapsible sections
- `Button, Badge, Input, ScrollArea, Separator, Tooltip` — from `@exegol/ui`
- `cn()` — from `@exegol/ui/lib/utils` for className merging

Do not reimplement what already exists. Check `components/common/index.ts` and `packages/ui/src/`.

### 3. useEffect audit
For EVERY useEffect you wrote, evaluate against these rules from the React team:
1. **Can the state be derived?** If the effect only does setState from other state/props → replace with inline computation or useMemo
2. **Is it a fetch?** → Should use the tRPC hooks pattern (use-trpc.ts), NOT useEffect + fetch
3. **Is it a response to user action?** → Move to event handler, not effect
4. **Is it syncing with an external system (DOM, xterm, IPC)?** → OK to use useMountEffect from `hooks/use-mount-effect.ts`
5. **Key reset pattern?** → Prefer `key` prop over complex dependency arrays

If you find any unnecessary useEffect, remove it and use the correct pattern.

### 4. Project patterns
- **tRPC**: use `trpcInvoke`/`trpcMutate` from `lib/trpc-client.ts`, not direct IPC calls
- **Zustand**: use granular selectors (do not destructure the entire store). Example: `useAgentStore(s => s.focusedAgentId)` not `const { focusedAgentId, agents, ... } = useAgentStore()`
- **Types**: share types via `@exegol/shared`, do not redefine in renderer
- **DB queries**: in separate files under `main/db/queries/`, not inline in procedures
- **IPC procedures**: in their own files under `main/ipc/procedures/`
- **Error handling**: try/catch in procedures, descriptive errors, do not silently swallow exceptions
- **Naming**: camelCase for TS, snake_case for DB columns, PascalCase for components

### 5. Documentation
- Verify each completed task has its `docs/applied/T{XX}_{name}.md`
- Each doc must include:
  - **Inspiration Source**: repo, files studied, pattern applied
  - **What Changed**: list of files created/modified
  - **Architecture Decisions**: why this approach, trade-offs considered
  - **How to Test**: manual testing steps

Apply all necessary corrections and report what you changed.
