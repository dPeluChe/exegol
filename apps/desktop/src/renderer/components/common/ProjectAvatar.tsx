import type { Project } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { Cuboid } from "lucide-react";
import { trpcInvoke } from "../../lib/trpc-client";
import { GROUP_ICONS } from "../layout/GroupIconColorPicker";

export function useProjectIconImage(project: Pick<Project, "id" | "iconImage">) {
  return useQuery({
    queryKey: ["projects", "iconImage", project.id, project.iconImage],
    queryFn: () => trpcInvoke<string | null>("projects.iconImage", { id: project.id }),
    enabled: !!project.iconImage,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** A project's own icon: its image (favicon, app icon), a chosen icon in its color, or the default */
export function ProjectAvatar({
  project,
  className,
  active,
}: {
  project: Pick<Project, "id" | "color" | "icon" | "iconImage">;
  className?: string;
  active?: boolean;
}) {
  const { data: image } = useProjectIconImage(project);
  if (image) {
    return (
      <img
        src={image}
        alt=""
        className={cn("h-3.5 w-3.5 shrink-0 rounded-sm object-contain", className)}
      />
    );
  }
  const Icon = (project.icon && GROUP_ICONS[project.icon]) || Cuboid;
  return (
    <Icon
      className={cn(
        "h-3.5 w-3.5 shrink-0",
        !project.color && (active === false ? "" : "text-accent"),
        className,
      )}
      style={project.color ? { color: project.color } : undefined}
    />
  );
}
