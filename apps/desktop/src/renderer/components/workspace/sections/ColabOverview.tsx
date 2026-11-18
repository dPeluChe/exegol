import type { Colab } from "@exegol/shared";
import { useProjects } from "../../../hooks/use-trpc";
import { memberKey, memberLabel } from "../../../lib/colab-room";
import { LABEL_CLASS } from "../../agents/SpawnOptions";
import { ProjectAvatar } from "../../common/ProjectAvatar";
import { RoleChip } from "./ColabRoom";

/** What a colab is, read only: purpose and who is in it, each with its role */
export function ColabOverview({ colab }: { colab: Colab }) {
  const { data: projects = [] } = useProjects();
  const byId = new Map(projects.map((p) => [p.id, p]));
  return (
    <div className="flex flex-col gap-3 p-4 text-xs">
      <h3 className="text-sm font-semibold text-text-primary">{colab.name}</h3>
      <p className="leading-relaxed text-text-secondary">
        {colab.purpose || "No purpose written yet: agents read it to know what belongs here."}
      </p>
      <div className={LABEL_CLASS}>Members</div>
      {colab.members.length === 0 && (
        <p className="text-text-muted">Nobody yet. Add the projects in Settings.</p>
      )}
      <ul className="flex flex-col gap-1.5">
        {colab.members.map((m) => {
          const project = byId.get(m.projectId);
          return (
            <li key={memberKey(m)} className="flex items-center gap-2">
              {project && <ProjectAvatar project={project} className="h-5 w-5" />}
              <span className="min-w-0 truncate text-text-primary">{memberLabel(m)}</span>
              <RoleChip member={m} />
              {m.role && <span className="min-w-0 truncate text-text-muted">{m.role}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
