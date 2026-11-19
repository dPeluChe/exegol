import type { ViewsState } from "@exegol/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke } from "../lib/trpc-client";
import { useMountEffect } from "./use-mount-effect";

const stateKey = (projectId: string) => ["views", "state", projectId];

/** The project's pass, kept current by `views:changed` (one view at a time while it runs) */
export function useViews(projectId: string) {
  const queryClient = useQueryClient();
  useMountEffect(() =>
    window.api.onViewsChanged((event) => {
      if (event.projectId !== projectId) return;
      queryClient.setQueryData<ViewsState>(stateKey(projectId), (old) => {
        if (old && event.run !== 0 && event.run < old.run) return old;
        if (event.state) return event.state;
        const view = event.view;
        if (!old || !view || event.run !== old.run) return old;
        const at = old.views.findIndex((v) => v.path === view.path);
        const views = at < 0 ? [...old.views, view] : old.views.with(at, view);
        return { ...old, views };
      });
    }),
  );
  return useQuery({
    queryKey: stateKey(projectId),
    queryFn: () => trpcInvoke<ViewsState>("views.state", { projectId }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useViewServers(projectId: string) {
  return useQuery({
    queryKey: ["views", "servers", projectId],
    queryFn: () => trpcInvoke<number[]>("views.servers", { projectId }),
  });
}

/** A thumbnail as a data URL; `shot` changes with each capture, so a new one is fetched */
export function useViewThumb(projectId: string, path: string, shot: number | undefined) {
  return useQuery({
    queryKey: ["views", "thumb", projectId, path, shot],
    queryFn: () => trpcInvoke<string | null>("views.thumb", { projectId, path }),
    enabled: shot !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 60_000,
  });
}
