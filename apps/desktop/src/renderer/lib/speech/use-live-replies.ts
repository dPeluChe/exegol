import type { SessionTurn } from "@exegol/shared";
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLatest } from "../../hooks/use-latest";
import { useMountEffect } from "../../hooks/use-mount-effect";
import type { ChatHistory } from "../session-chat";
import { liveReply } from "./live-reply";

/** `onReply`: a reply finished while the chat is open, seen on the chat fetch that follows a
 *  turn-boundary push. Turns the chat opened with, or that replaced its history, never qualify */
export function useLiveReplies(agentId: string, onReply?: (turn: SessionTurn) => void) {
  const queryClient = useQueryClient();
  const latest = useLatest(onReply);
  const [live] = useState(() => ({
    seen: null as Set<string> | null,
    firstId: null as string | null,
    lastRead: null as string | null,
    pushed: false,
  }));
  useMountEffect(() => {
    const queryKey = ["chatTurns", agentId];
    const hash = hashKey(queryKey);
    const remember = (turns: readonly SessionTurn[]) => {
      live.seen ??= new Set();
      for (const t of turns) live.seen.add(t.id);
    };
    const held = queryClient.getQueryData<ChatHistory>(queryKey);
    if (held) remember(held.turns);
    live.firstId = held?.turns[0]?.id ?? null;
    const offCache = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      if (event.query.queryHash !== hash) return;
      const history = event.query.state.data as ChatHistory | undefined;
      if (!history) return;
      // First page, a reset or earlier turns put in front: all of it is backlog
      const firstId = history.turns[0]?.id ?? null;
      if (!live.seen || (live.firstId !== null && firstId !== live.firstId)) {
        remember(history.turns);
      }
      live.firstId = firstId;
      if (!live.pushed) return;
      live.pushed = false;
      const turn = live.seen && liveReply(history.turns, live.seen, live.lastRead);
      if (!turn || !latest.current) return;
      live.lastRead = turn.id;
      latest.current(turn);
    });
    const offPush = window.api.onChatUpdated((event) => {
      if (event.agentId === agentId) live.pushed = true;
    });
    return () => {
      offCache();
      offPush();
    };
  });
}
