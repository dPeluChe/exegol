import { type CommanderUnread, NO_COMMANDER_UNREAD } from "@exegol/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";
import { useMountEffect } from "./use-mount-effect";

const UNREAD_KEY = ["commander", "unread"];
// Always on top: in view without the focus
const FLOATING = new URLSearchParams(window.location.search).has("floatingPane");

const inView = (focused: boolean) =>
  document.visibilityState === "visible" && (FLOATING || focused);

/** Replies the Commander ended with its chat out of view (`commander.unread`, pushed on change) */
export function useCommanderUnread(enabled = true) {
  const queryClient = useQueryClient();
  useMountEffect(() =>
    enabled
      ? window.api.onCommanderUnread((unread) => queryClient.setQueryData(UNREAD_KEY, unread))
      : undefined,
  );
  const { data } = useQuery({
    queryKey: UNREAD_KEY,
    queryFn: () => trpcInvoke<CommanderUnread>("commander.unread"),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return { unread: data ?? NO_COMMANDER_UNREAD, loaded: data !== undefined };
}

/** The Commander's chat is mounted here: what was unread is read once this window shows it.
 *  Returns where the unread replies began on arrival, for the mark in the chat */
export function useSeesCommander(active: boolean): number | null {
  const { unread, loaded } = useCommanderUnread(active);
  const [seeing, setSeeing] = useState(() => active && inView(document.hasFocus()));
  const [since, setSince] = useState<number | null>(null);
  const arriving = useRef(true);
  // `active` is fixed for a mounted chat
  useMountEffect(() => {
    if (!active) return;
    let focused = document.hasFocus();
    const check = () => setSeeing(inView(focused));
    // App-level focus (main's relay), not the DOM blur: a browser pane's webview blurs the page
    const offFocus = window.api.onWindowFocus((now) => {
      focused = now;
      check();
    });
    document.addEventListener("visibilitychange", check);
    return () => {
      offFocus();
      document.removeEventListener("visibilitychange", check);
    };
  });
  // Main holds the count: a read is told to it, and every window follows its push
  useEffect(() => {
    if (!seeing) {
      arriving.current = true;
      return;
    }
    if (!loaded) return;
    if (arriving.current) setSince(unread.count > 0 ? unread.since : null);
    arriving.current = false;
    if (unread.count > 0) void trpcMutate("commander.markRead").catch(() => {});
  }, [seeing, loaded, unread]);
  return since;
}
