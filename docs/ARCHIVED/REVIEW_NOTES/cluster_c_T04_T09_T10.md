# Review Notes — Cluster C: Tab Content (T04, T09, T10)

## Tasks completed
- T04: Task Viewer from Markdown — parser for `- [ ]`/`- [x]` tasks, file I/O tRPC procedures, interactive TasksSection with progress bar and write-back
- T09: Prompts & Templates — DB migration 011, CRUD queries, tRPC router, PromptsSection with category filters/cards/dialog, sidebar pinned prompts, spawn dialog integration
- T10: File Explorer Panel — directory listing procedure, lazy-loaded tree view with file preview, integrated as toggleable panel in AgentsSection

## What I'd improve with more time
- TasksSection: async probe multiple file candidates (TODO.md, plan.md, TASKS.md) before defaulting
- PromptsSection: add prompt search/filter by text, drag-and-drop reorder for pinned
- FileExplorer: syntax highlighting in preview (e.g. highlight.js), search within file tree
- Add keyboard shortcuts for new tabs (Prompts, Tasks)

## Issues found in review and resolved
- CRITICAL: Dynamic SQL string concatenation in `updatePrompt` → replaced with COALESCE-based single query
- CRITICAL: Label missing htmlFor for task checkboxes → added htmlFor + id pairing
- IMPORTANT: useEffect breaking on first file candidate → simplified to direct TODO.md default
- IMPORTANT: CustomEvent type assertion without guard → added instanceof + property checks
- IMPORTANT: No path traversal guard in files procedure → added `assertPathInsideProject` that validates against registered projects
- IMPORTANT: No delete confirmation for prompts → added ConfirmDialog with destructive variant
- IMPORTANT: TasksSection showed error when auto-detected file missing → added graceful fallback to empty state

## Edge cases not handled
- TasksSection: very large markdown files (>10k lines) may be slow to parse/re-render on toggle
- TasksSection: nested task toggling doesn't cascade to children
- FileExplorer: symlinks may cause infinite recursion in nested directory expansion

## Shared file conflicts risk
Files touched that other clusters may also modify:
- `router.ts`: added `files: filesRouter` and `prompts: promptsRouter` (lines 9-10, 17-18)
- `queries.ts`: added mapPromptRow + 5 prompt functions (lines 21-31, 329-378)
- `migrations.ts`: added migration 011_prompts (lines 173-185)
- `use-trpc.ts`: added Files hooks (lines 119-159), Prompts hooks (lines 161-253)
- `WorkspaceTabs.tsx`: added 'prompts' to WorkspaceSection type and SECTIONS array (lines 14-22)
- `WorkspaceView.tsx`: added PromptsSection import and render (lines 8, 35)
- `SidebarFooter.tsx`: added PinnedPrompts section (full rewrite)
- `TerminalTabs.tsx`: added `extraActions` prop (lines 31-33, 114-115)
- `AgentsSection.tsx`: added FileExplorer panel toggle (lines 6, 11, 16-17, 32-57)
- `SpawnAgentDialog.tsx`: added prompt event listener (lines 35-46)

## Performance notes
- FileExplorer uses lazy loading: only fetches directory contents when a node is expanded
- useFileContent and useDirectoryListing use React Query with proper `enabled` flags
- PromptsSection filters are client-side (no extra DB queries per category switch)
- Task toggle does a full file write-back — acceptable for markdown files but would need optimization for very large files

## New files created
- `packages/shared/src/types/prompt.ts` — Prompt, PromptCreate, PromptUpdate, PromptCategory types
- `apps/desktop/src/renderer/lib/markdown-tasks.ts` — parseMarkdownTasks, toggleTask functions
- `apps/desktop/src/main/ipc/procedures/files.ts` — tRPC router: readFile, writeFile, pickFile, listDirectory
- `apps/desktop/src/main/ipc/procedures/prompts.ts` — tRPC router: list, create, update, delete, togglePin
- `apps/desktop/src/renderer/components/workspace/sections/PromptsSection.tsx` — PromptsSection, PromptCard, PromptDialog
- `apps/desktop/src/renderer/components/workspace/FileExplorer.tsx` — FileExplorer, DirectoryNode, FileNode

## New DB migrations
- Migration 011_prompts: `prompts` table with id, project_id (FK), title, content, category (CHECK), pinned, created_at, updated_at

## New tRPC routes
- `files.readFile` — read file content with language detection
- `files.writeFile` — write content to file
- `files.pickFile` — Electron open dialog for file selection
- `files.listDirectory` — list directory entries with .gitignore filtering
- `prompts.list` — list prompts for a project (pinned first)
- `prompts.create` — create a new prompt
- `prompts.update` — update prompt fields via COALESCE
- `prompts.delete` — delete a prompt
- `prompts.togglePin` — toggle pinned state
