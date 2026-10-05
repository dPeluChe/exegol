import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke } from "../lib/trpc-client";
import { useMountEffect } from "./use-mount-effect";

export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "up-to-date"
  | "error";

export interface UpdateStatus {
  status: UpdateState;
  info: { version?: string; percent?: number; message?: string };
}

const KEY = ["updates", "status"];
let settle: ReturnType<typeof setTimeout> | undefined;

function setStatus(queryClient: QueryClient, next: UpdateStatus): void {
  clearTimeout(settle);
  queryClient.setQueryData<UpdateStatus>(KEY, next);
}

/** Back to idle after `ms` if still `status` */
function settleTo(queryClient: QueryClient, status: UpdateState, ms: number): void {
  settle = setTimeout(() => {
    const cur = queryClient.getQueryData<UpdateStatus>(KEY);
    if (cur?.status === status)
      queryClient.setQueryData<UpdateStatus>(KEY, { ...cur, status: "idle" });
  }, ms);
}

/** The updater's status: seeded from main's last one, then followed by `useUpdateStatusSync` */
export function useUpdateStatus(): UpdateStatus {
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => trpcInvoke<UpdateStatus>("updates.status"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return data ?? { status: "idle", info: {} };
}

/** Mounted once (App): the one subscription to the updater's push */
export function useUpdateStatusSync(): void {
  const queryClient = useQueryClient();
  useMountEffect(() =>
    window.api?.updater?.onStatus?.((data) => {
      const next = data as UpdateStatus;
      setStatus(queryClient, next);
      // "Up to date" is a moment, not a state to keep on screen
      if (next.status === "up-to-date") settleTo(queryClient, "up-to-date", 4_000);
    }),
  );
}

/** A check the user asked for */
export function useCheckForUpdates(): () => void {
  const queryClient = useQueryClient();
  return () => {
    const cur = queryClient.getQueryData<UpdateStatus>(KEY);
    setStatus(queryClient, { status: "checking", info: cur?.info ?? {} });
    window.api?.updater?.check?.();
    // Dev builds and silenced errors answer nothing: do not spin forever
    settleTo(queryClient, "checking", 15_000);
  };
}
