import { useState } from "react";
import { useModelAction } from "../../hooks/use-trpc-models";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { formatBytes } from "../workspace/sections/resource-format";

interface ModelToDelete {
  id: string;
  name: string;
  installedBytes: number;
}

/** "Delete model?" confirmation shared by the Models and Storage tabs */
export function useConfirmDeleteModel() {
  const action = useModelAction();
  const [model, setModel] = useState<ModelToDelete | null>(null);
  const dialog = (
    <ConfirmDialog
      open={model !== null}
      onOpenChange={(open) => !open && setModel(null)}
      title="Delete model?"
      description={
        model
          ? `${model.name} (${formatBytes(model.installedBytes)}) will be removed from disk. You can download it again from the Models tab.`
          : ""
      }
      confirmLabel="Delete"
      variant="destructive"
      onConfirm={() => model && action.mutate({ action: "delete", id: model.id })}
    />
  );
  return { requestDelete: setModel, dialog };
}
