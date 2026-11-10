import type { ProjectMeta } from "../../common/ProjectChip";
import { CommanderFleet } from "./CommanderFleet";
import { CommanderPanel, useCommanderSession } from "./CommanderPanel";

/** The Commander's chat beside the fleet it watches */
export function CommanderSection({
  projectMeta,
}: {
  projectMeta: ReadonlyMap<string, ProjectMeta>;
}) {
  const { projectId, session, state } = useCommanderSession();
  if (!state) return null;
  return (
    <div className="flex min-h-0 w-full flex-1 gap-3 px-4 pb-4">
      <CommanderPanel
        session={session}
        state={state}
        aside={
          projectId && <CommanderFleet commanderProjectId={projectId} projectMeta={projectMeta} />
        }
      />
    </div>
  );
}
