import type { SpawnPreview } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { Copy, GitBranch, Layers } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useProject } from "../../hooks/use-trpc";
import { tailPath } from "../../lib/format";
import { trpcInvoke } from "../../lib/trpc-client";
import { SpawnChip } from "./SpawnOptions";

const PLACES = [
  { isolated: false, label: "Here", hint: "The project checkout, shared with others" },
  { isolated: true, label: "Worktree", hint: "Its own branch, for parallel work" },
];

function useSpawnPreview(
  projectId: string,
  providerId: string,
  task: string,
  branchName: string,
  useWorktree: boolean,
) {
  // Debounced because both inputs change per keystroke, and each ask is an IPC
  // round-trip plus a directory read on the thread that pumps PTY output.
  const [settled, setSettled] = useState({ task: "", branch: "" });
  useEffect(() => {
    const t = setTimeout(() => setSettled({ task, branch: branchName }), 300);
    return () => clearTimeout(t);
  }, [task, branchName]);

  // Only the worktree path needs resolving, and only the main process can: the
  // branch may already have a worktree (reused as-is) or collide (suffixed), and
  // the default branch name is derived from the task by the spawn path itself.
  const { data: preview } = useQuery({
    queryKey: ["spawnPreview", projectId, providerId, settled.task, settled.branch],
    queryFn: () =>
      trpcInvoke<SpawnPreview>("agents.previewSpawn", {
        projectId,
        cliType: providerId,
        useWorktree: true,
        // Trimmed exactly as the spawn trims it, or a leading space shows
        // `exegol/-fix-bug` on screen and creates `exegol/fix-bug`.
        taskDescription: settled.task.trim(),
        branchName: settled.branch.trim() || undefined,
      }),
    enabled: !!projectId && !!providerId && useWorktree,
    placeholderData: (prev) => prev,
    staleTime: 5_000,
  });
  return { preview, settledBranch: settled.branch };
}

/** Where the agent works. Framed as a place, not a git feature: the question the
 *  user is answering is "which directory will this touch", and the answer should
 *  always be visible — never inferred. */
export function SpawnWorkLocation({
  projectId,
  providerId,
  task,
  useWorktree,
  onWorktree,
  branchName,
  branchEdited,
  onBranch,
  baseBranch,
  onBaseBranch,
}: {
  projectId: string;
  providerId: string;
  task: string;
  useWorktree: boolean;
  onWorktree: (isolated: boolean) => void;
  branchName: string;
  branchEdited: boolean;
  onBranch: (value: string) => void;
  baseBranch: string;
  onBaseBranch: (value: string) => void;
}) {
  const { data: project } = useProject(projectId);
  const { preview, settledBranch } = useSpawnPreview(
    projectId,
    providerId,
    task,
    branchName,
    useWorktree,
  );
  const workingPath = useWorktree ? (preview?.cwd ?? "") : (project?.path ?? "");

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-text-muted">Where to work</span>
      <div className="flex gap-1.5">
        {PLACES.map(({ isolated, label, hint }) => (
          <SpawnChip
            key={label}
            selected={useWorktree === isolated}
            onClick={() => onWorktree(isolated)}
            title={hint}
            className="flex items-center gap-1.5"
          >
            {isolated ? <GitBranch className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
            {label}
          </SpawnChip>
        ))}
      </div>

      {/* WHERE the agent will actually run — the project checkout, or the
          Exegol-owned worktree root, which is not the same directory. Shown,
          never edited: only the branch is yours to name. */}
      <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
        <span className="shrink-0">Path</span>
        <code title={workingPath}>{tailPath(workingPath)}</code>
        {workingPath && (
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(workingPath)}
            title="Copy full path"
            className="text-text-muted hover:text-text-secondary"
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>

      {useWorktree && (
        <WorktreeBranchFields
          projectId={projectId}
          preview={preview}
          settledBranch={settledBranch}
          // Empty until edited: the field shows what the spawn resolved, not a guess.
          shownBranch={branchEdited ? branchName : (preview?.branchName ?? "")}
          onBranch={onBranch}
          baseBranch={baseBranch}
          onBaseBranch={onBaseBranch}
        />
      )}
    </div>
  );
}

function WorktreeBranchFields({
  projectId,
  preview,
  settledBranch,
  shownBranch,
  onBranch,
  baseBranch,
  onBaseBranch,
}: {
  projectId: string;
  preview: SpawnPreview | undefined;
  settledBranch: string;
  shownBranch: string;
  onBranch: (value: string) => void;
  baseBranch: string;
  onBaseBranch: (value: string) => void;
}) {
  const { data: branchInfo } = useQuery({
    queryKey: ["projectBranches", projectId],
    queryFn: () =>
      trpcInvoke<{ current: string; branches: string[] }>("diff.listBranches", { projectId }),
    staleTime: 30_000,
  });
  const baseId = useId();
  const branchId = useId();

  return (
    <div className="flex flex-col gap-1.5">
      {/* Which branch it is CUT FROM. Was always the repo's HEAD and
          never stated, so an agent silently inherited whatever the
          main checkout was on (T177). */}
      <div className="flex items-center gap-2">
        <label htmlFor={baseId} className="w-10 shrink-0 text-[10px] text-text-muted">
          from
        </label>
        <select
          id={baseId}
          value={baseBranch || branchInfo?.current || ""}
          onChange={(e) => onBaseBranch(e.target.value)}
          className="flex-1 rounded border border-border bg-bg-secondary px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent/50"
        >
          {(branchInfo?.branches ?? []).map((b) => (
            <option key={b} value={b}>
              {b}
              {b === branchInfo?.current ? " (current)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={branchId} className="w-10 shrink-0 text-[10px] text-text-muted">
          new
        </label>
        <input
          id={branchId}
          type="text"
          value={shownBranch}
          onChange={(e) => onBranch(e.target.value)}
          placeholder="exegol/branch-name"
          className="flex-1 rounded border border-border bg-bg-secondary px-2 py-1 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
        />
      </div>
      {/* Landing somewhere other than the name on screen is how work
          gets lost, so both surprises are stated. */}
      {preview?.reused && (
        <span className="pl-12 text-[10px] text-warning">
          a worktree already exists on this branch — it will be reused
        </span>
      )}
      {!preview?.reused &&
        preview?.branchName &&
        settledBranch &&
        preview.branchName !== settledBranch && (
          <span className="pl-12 text-[10px] text-warning">
            taken — will create <code>{preview.branchName}</code>
          </span>
        )}
    </div>
  );
}
