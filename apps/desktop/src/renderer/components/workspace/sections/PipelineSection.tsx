import type { PipelineTemplate } from "@exegol/shared";
import { useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import {
  useDeletePipelineTemplate,
  usePipelineRuns,
  usePipelineTemplates,
} from "../../../hooks/use-trpc-pipeline";
import { ConfirmDialog } from "../../common/ConfirmDialog";

import { PipelineRunList } from "./pipeline/PipelineRunList";
import { PipelineRunView } from "./pipeline/PipelineRunView";
import { PipelineStartBar } from "./pipeline/PipelineStartBar";
import { PipelineTemplateEditor } from "./pipeline/PipelineTemplateEditor";
import { PipelineTemplateList } from "./pipeline/PipelineTemplateList";
import { usePipelineLauncher } from "./pipeline/use-pipeline-launcher";

type View =
  | { type: "list" }
  | { type: "editor"; template?: PipelineTemplate }
  | { type: "run"; runId: string };

export function PipelineSection() {
  const { projectId } = useProjectContext();
  const { data: templates } = usePipelineTemplates(projectId);
  const { data: runs } = usePipelineRuns(projectId);
  const deleteTemplate = useDeletePipelineTemplate();

  const [view, setView] = useState<View>({ type: "list" });
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const launcher = usePipelineLauncher(projectId, templates, (runId) =>
    setView({ type: "run", runId }),
  );

  if (view.type === "editor") {
    return (
      <PipelineTemplateEditor
        existingId={view.template?.id}
        existingName={view.template?.name}
        existingDescription={view.template?.description}
        existingSteps={view.template?.steps}
        onClose={() => setView({ type: "list" })}
      />
    );
  }

  if (view.type === "run") {
    return <PipelineRunView runId={view.runId} onClose={() => setView({ type: "list" })} />;
  }

  return (
    <div className="flex h-full flex-col">
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete pipeline "${pendingDelete?.name ?? ""}"?`}
        description="The template is deleted; past runs stay in the history."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteTemplate.mutate(pendingDelete.id);
        }}
      />
      <PipelineStartBar templates={templates} launcher={launcher} />

      <div className="flex flex-1 overflow-hidden">
        <PipelineTemplateList
          projectId={projectId}
          templates={templates}
          selectedTemplateId={launcher.selectedTemplateId}
          onSelect={launcher.setSelectedTemplateId}
          onEdit={(template) => setView({ type: "editor", template })}
          onDelete={setPendingDelete}
        />
        <PipelineRunList runs={runs} onOpen={(runId) => setView({ type: "run", runId })} />
      </div>
    </div>
  );
}
