import type { Colab, InboxThread } from "@exegol/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke } from "../lib/trpc-client";
import { useMountEffect } from "./use-mount-effect";

const NO_THREADS: InboxThread[] = [];
const NO_COLABS: Colab[] = [];

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

/** Under "inbox": a colab change pushes `inbox:changed` too */
export function useColabs(): Colab[] {
  const { data } = useQuery({
    queryKey: ["inbox", "colabs"],
    queryFn: () => trpcInvoke<Colab[]>("colabs.list"),
  });
  return data ?? NO_COLABS;
}
