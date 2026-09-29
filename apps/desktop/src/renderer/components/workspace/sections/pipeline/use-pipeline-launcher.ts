import type { PipelineTemplate } from "@exegol/shared";
import { useState } from "react";
import { useStartPipelineRun } from "../../../../hooks/use-trpc-pipeline";
import { trpcInvoke } from "../../../../lib/trpc-client";

/** Start-run bar state: template pick, task text, worktree toggle and the git-sync gate. */
export function usePipelineLauncher(
  projectId: string | null,
  templates: PipelineTemplate[] | undefined,
  onStarted: (runId: string) => void,
) {
  const startRun = useStartPipelineRun();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [useWorktree, setUseWorktree] = useState(true);
  const [task, setTask] = useState("");
  const trimmedTask = task.trim();
  const [gitWarning, setGitWarning] = useState<string | null>(null);

  const selectedTemplate = templates?.find((t) => t.id === selectedTemplateId);
  // Derived: a template deleted (here or elsewhere) can no longer be run
  const canRun = !!selectedTemplate && !!trimmedTask;

  // `worktree` passed in: "Run without worktree" set the state and ran with the stale value
  const handleStartRun = async (worktree = useWorktree) => {
    if (!projectId || !canRun || !selectedTemplate) return;

    // Check git sync before creating worktree
    if (worktree) {
      try {
        const sync = await trpcInvoke<{
          clean: boolean;
          message: string;
        }>("pipeline.checkGitSync", { projectId });
        if (!sync.clean) {
          setGitWarning(sync.message);
          return;
        }
      } catch {
        // Non-fatal
      }
    }
    setGitWarning(null);

    startRun.mutate(
      {
        templateId: selectedTemplate.id,
        projectId,
        task: trimmedTask,
        useWorktree: worktree,
      },
      {
        onSuccess: (run) => {
          onStarted(run.id);
        },
      },
    );
  };

  const runWithoutWorktree = () => {
    setGitWarning(null);
    setUseWorktree(false);
    handleStartRun(false);
  };

  return {
    selectedTemplateId,
    setSelectedTemplateId,
    selectedTemplate,
    useWorktree,
    setUseWorktree,
    task,
    setTask,
    gitWarning,
    dismissGitWarning: () => setGitWarning(null),
    canRun,
    isStarting: startRun.isPending,
    handleStartRun,
    runWithoutWorktree,
  };
}

export type PipelineLauncher = ReturnType<typeof usePipelineLauncher>;
