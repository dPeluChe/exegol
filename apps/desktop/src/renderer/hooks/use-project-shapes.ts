import type { ProjectShape } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { trpcInvoke } from "../lib/trpc-client";

/** Repo, workspace or plain folder per project id, cached in main with the GitHub menu's walk */
export function useProjectShapes(): Record<string, ProjectShape> | undefined {
  const { data } = useQuery({
    queryKey: ["projectShapes"],
    queryFn: () => trpcInvoke<Record<string, ProjectShape>>("projects.shapes"),
    staleTime: 5 * 60_000,
  });
  return data;
}
