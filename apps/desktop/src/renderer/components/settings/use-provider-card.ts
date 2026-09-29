import { type AgentProvider, YOLO_FLAGS } from "@exegol/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { trpcMutate } from "../../lib/trpc-client";
import { mutateCli } from "./mutate-cli";

/** One provider card's edits: default args, the YOLO flag, enabled, and a custom CLI's identity. */
export function useProviderCard(provider: AgentProvider) {
  const queryClient = useQueryClient();
  const [args, setArgs] = useState(() => provider.args.join(", "));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flash = useCallback(() => {
    setError(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, []);
  const saveIdentity = async (name: string, command: string) => {
    if (name === provider.name && command === provider.command) return;
    const ok = await mutateCli(
      queryClient,
      () => trpcMutate("agents.updateCustomProvider", { id: provider.id, name, command }),
      setError,
    );
    if (ok) flash();
  };

  const yoloFlag = YOLO_FLAGS[provider.id];
  const isYolo = yoloFlag ? provider.args.includes(yoloFlag) : false;
  const isEnabled = provider.enabled !== false;

  const saveArgs = useCallback(
    async (newArgs: string[]) => {
      const ok = await mutateCli(
        queryClient,
        () => trpcMutate("agents.updateProviderArgs", { id: provider.id, args: newArgs }),
        setError,
      );
      if (ok) {
        setDirty(false);
        flash();
      }
    },
    [provider.id, queryClient, flash],
  );

  const handleSave = useCallback(() => {
    if (!dirty) return;
    saveArgs(
      args
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }, [args, dirty, saveArgs]);

  const toggleYolo = useCallback(() => {
    if (!yoloFlag) return;
    const current = args
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const newArgs = isYolo ? current.filter((a) => a !== yoloFlag) : [...current, yoloFlag];
    setArgs(newArgs.join(", "));
    saveArgs(newArgs);
  }, [yoloFlag, isYolo, args, saveArgs]);

  const toggleEnabled = useCallback(async () => {
    const ok = await mutateCli(
      queryClient,
      () => trpcMutate("agents.toggleProviderEnabled", { id: provider.id, enabled: !isEnabled }),
      setError,
    );
    if (ok) flash();
  }, [provider.id, isEnabled, queryClient, flash]);

  const editArgs = (value: string) => {
    setArgs(value);
    setDirty(true);
  };

  return {
    args,
    editArgs,
    dirty,
    saved,
    error,
    yoloFlag,
    isYolo,
    isEnabled,
    saveIdentity,
    handleSave,
    toggleYolo,
    toggleEnabled,
  };
}
