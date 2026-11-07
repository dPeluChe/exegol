import type { InboxThread } from "@exegol/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke } from "../lib/trpc-client";
import { useMountEffect } from "./use-mount-effect";

const NO_THREADS: InboxThread[] = [];

/** One listener app-wide: every inbox query shares the "inbox" prefix */
export function useInboxSync() {
  const queryClient = useQueryClient();
  useMountEffect(() =>
    window.api.onInboxChanged(() => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    }),
  );
}

export function useInboxThreads(state: "active" | "closed", enabled = true): InboxThread[] {
  const { data } = useQuery({
    queryKey: ["inbox", state],
    queryFn: () => trpcInvoke<InboxThread[]>("inbox.list", { state }),
    enabled,
  });
  return data ?? NO_THREADS;
}
