import { cn } from "@exegol/ui";

export interface ProjectMeta {
  name: string;
  color: string | null;
}

/** Which project a session belongs to, in its group colour. */
export function ProjectChip({ project, className }: { project: ProjectMeta; className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full bg-white/5 px-1.5 py-0.5 text-text-muted",
        className,
      )}
      title={project.name}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", !project.color && "bg-accent")}
        style={project.color ? { backgroundColor: project.color } : undefined}
      />
      <span className="max-w-[120px] truncate">{project.name}</span>
    </span>
  );
}
