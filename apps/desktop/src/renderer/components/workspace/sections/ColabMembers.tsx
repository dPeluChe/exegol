import { type Colab, memberRole } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Star } from "lucide-react";
import { useProjects } from "../../../hooks/use-trpc";
import { memberKey, memberLabel } from "../../../lib/colab-room";
import { ProjectAvatar } from "../../common/ProjectAvatar";
import { ROLE_CHIP } from "./ColabRoom";

/** Who is in a colab, one small chip each, the main dev marked */
export function ColabMembers({ colab }: { colab: Colab }) {
  const { data: projects = [] } = useProjects();
  const byId = new Map(projects.map((p) => [p.id, p]));
  if (colab.members.length === 0) {
    return <p className="text-[10px] text-text-muted">Nobody yet. Add the projects in Settings.</p>;
  }
  return (
    <ul className="flex flex-wrap items-center gap-1">
      {colab.members.map((m) => {
        const project = byId.get(m.projectId);
        const role = memberRole(m);
        return (
          <li
            key={memberKey(m)}
            title={[`${role.label}: ${role.does}`, m.role].filter(Boolean).join(". ")}
            className={cn(
              ROLE_CHIP,
              "px-1.5",
              m.main
                ? "border-[var(--accent)]/70 text-text-primary"
                : "border-border text-text-secondary",
            )}
          >
            {project && <ProjectAvatar project={project} className="h-3.5 w-3.5" />}
            <span className="max-w-40 truncate">{memberLabel(m)}</span>
            {m.main && <Star aria-label="main dev" className="h-2.5 w-2.5 fill-current" />}
          </li>
        );
      })}
    </ul>
  );
}
