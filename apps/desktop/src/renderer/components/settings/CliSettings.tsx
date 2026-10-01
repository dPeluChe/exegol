import type { AgentProvider } from "@exegol/shared";
import { Button, cn, Input } from "@exegol/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Plus,
  RotateCcw,
  Shield,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { useCallback, useState } from "react";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { AgentIcon } from "../common/AgentIcon";
import { CopyCommand } from "../common/CopyCommand";
import { mutateCli } from "./mutate-cli";
import { useProviderCard } from "./use-provider-card";

function useProviders() {
  return useQuery({
    queryKey: ["providers"],
    queryFn: () => trpcInvoke<AgentProvider[]>("agents.listProviders"),
    staleTime: 60_000,
  });
}

// ─── Provider Card (full visible, no collapse) ─────────────────────────────

function ProviderCard({
  provider,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  provider: AgentProvider;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
}) {
  const card = useProviderCard(provider);

  return (
    <div
      className={cn(
        "relative flex flex-col gap-2.5 rounded-xl border bg-bg-secondary p-3 transition-all",
        !card.isEnabled && "opacity-40",
        card.saved ? "border-green-500/50" : "border-border",
      )}
    >
      {/* Saved indicator */}
      {card.saved && (
        <span className="absolute right-2 top-2 text-[8px] font-medium text-green-400">
          saved ✓
        </span>
      )}
      {/* Top: arrows + icon + name */}
      <div className="flex items-start gap-2">
        <ReorderArrows onMoveUp={onMoveUp} onMoveDown={onMoveDown} />

        {/* Icon */}
        <AgentIcon
          provider={provider.id}
          size={36}
          fallback={provider.icon}
          fallbackColor={provider.color}
        />

        {/* Name + command */}
        <div className="flex-1">
          <ProviderIdentity provider={provider} onSave={card.saveIdentity} />
          {card.error && <p className="mt-1 text-[10px] text-red-400">{card.error}</p>}
          <CapabilityBadges capabilities={provider.capabilities} />
          {provider.installed === false && (
            <div className="mt-1.5 flex flex-col gap-1 text-[10px] text-amber-400">
              <span>Not installed on this machine: the launchers leave it out</span>
              {provider.installCommand && (
                <CopyCommand label="Install" command={provider.installCommand} />
              )}
            </div>
          )}
        </div>

        {/* Action badges: Active + Safe/YOLO + Delete — same row as name */}
        <div className="flex items-center gap-1">
          <EnabledToggle isEnabled={card.isEnabled} onToggle={card.toggleEnabled} />
          {card.yoloFlag && (
            <YoloToggle yoloFlag={card.yoloFlag} isYolo={card.isYolo} onToggle={card.toggleYolo} />
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-red-500/10 hover:text-error"
              title="Remove"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Default arguments */}
      <div>
        <div className="mb-1 text-[9px] text-text-muted">Default arguments</div>
        <div className="flex items-center gap-1.5">
          <Input
            value={card.args}
            onChange={(e) => card.editArgs(e.target.value)}
            onBlur={card.handleSave}
            onKeyDown={(e) => {
              if (e.key === "Enter") card.handleSave();
            }}
            placeholder="--flag, --other-flag"
            className="h-7 flex-1 border-[var(--border)] bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-primary)]"
          />
          {card.dirty && <span className="shrink-0 text-[8px] text-accent">•</span>}
        </div>
      </div>
    </div>
  );
}

function ReorderArrows({
  onMoveUp,
  onMoveDown,
}: {
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5 pt-1">
      <button
        type="button"
        onClick={onMoveUp}
        disabled={!onMoveUp}
        aria-label="Move up"
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded",
          onMoveUp ? "text-text-muted hover:bg-white/10 hover:text-text-primary" : "invisible",
        )}
      >
        <ChevronUp className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={!onMoveDown}
        aria-label="Move down"
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded",
          onMoveDown ? "text-text-muted hover:bg-white/10 hover:text-text-primary" : "invisible",
        )}
      >
        <ChevronDown className="h-3 w-3" />
      </button>
    </div>
  );
}

function ProviderIdentity({
  provider,
  onSave,
}: {
  provider: AgentProvider;
  onSave: (name: string, command: string) => void;
}) {
  if (provider.isBuiltin) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-text-primary">{provider.name}</span>
        <code className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[9px] text-text-muted">
          {provider.command}
        </code>
      </div>
    );
  }
  // A custom CLI names itself: saved on blur or Enter
  return (
    <div className="flex items-center gap-1.5">
      <input
        defaultValue={provider.name}
        aria-label="Name"
        onBlur={(e) => onSave(e.currentTarget.value.trim(), provider.command)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="w-32 min-w-0 rounded border border-border bg-bg-tertiary px-1.5 py-0.5 text-sm font-semibold text-text-primary outline-none focus:border-accent/50"
      />
      <input
        defaultValue={provider.command}
        aria-label="Command"
        onBlur={(e) => onSave(provider.name, e.currentTarget.value.trim())}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="w-36 min-w-0 rounded border border-border bg-bg-tertiary px-1.5 py-0.5 font-mono text-[10px] text-text-secondary outline-none focus:border-accent/50"
      />
    </div>
  );
}

function CapabilityBadges({ capabilities }: { capabilities: AgentProvider["capabilities"] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {capabilities.supportsPromptArg && <CapBadge label="prompt" />}
      {capabilities.promptFlag && <CapBadge label={`flag: ${capabilities.promptFlag}`} />}
      {capabilities.supportsWorktree && <CapBadge label="worktree" />}
      {capabilities.supportsResume && <CapBadge label="resume" />}
      {capabilities.supportsVision && <CapBadge label="vision" />}
    </div>
  );
}

function EnabledToggle({ isEnabled, onToggle }: { isEnabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-medium transition-all",
        isEnabled
          ? "bg-green-500/15 text-green-400 hover:bg-green-500/25"
          : "bg-white/5 text-text-muted hover:bg-white/10",
      )}
      title={isEnabled ? "Visible in launcher" : "Hidden from launcher"}
    >
      {isEnabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
      {isEnabled ? "Active" : "Hidden"}
    </button>
  );
}

function YoloToggle({
  yoloFlag,
  isYolo,
  onToggle,
}: {
  yoloFlag: string;
  isYolo: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-medium transition-all",
        isYolo
          ? "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30"
          : "bg-white/5 text-text-muted hover:bg-white/10",
      )}
      title={isYolo ? `Auto-approve ON (${yoloFlag})` : "Auto-approve OFF"}
    >
      {isYolo ? <ShieldOff className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
      {isYolo ? "YOLO" : "Safe"}
    </button>
  );
}

function CapBadge({ label }: { label: string }) {
  return <span className="rounded bg-white/5 px-1 py-0.5 text-[8px] text-text-muted">{label}</span>;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function CliSettings() {
  const { data: providers, isLoading } = useProviders();
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);
  const builtins = providers?.filter((p) => p.isBuiltin && p.id !== "shell") ?? [];
  const customs = providers?.filter((p) => !p.isBuiltin) ?? [];

  const handleAddCustom = useCallback(async () => {
    await mutateCli(
      queryClient,
      () =>
        trpcMutate("agents.registerProvider", {
          id: `custom-${Date.now()}`,
          name: "New Agent",
          command: "my-agent",
        }),
      setError,
    );
  }, [queryClient]);

  const handleRemoveCustom = useCallback(
    async (id: string) => {
      await mutateCli(queryClient, () => trpcMutate("agents.unregisterProvider", { id }), setError);
    },
    [queryClient],
  );

  const handleResetArgs = useCallback(async () => {
    await mutateCli(queryClient, () => trpcMutate("agents.resetProviderArgs"), setError);
  }, [queryClient]);

  const allProviders = [...builtins, ...customs];

  const handleSwap = useCallback(
    async (idA: string, idB: string) => {
      await mutateCli(
        queryClient,
        () => trpcMutate("agents.swapProviders", { idA, idB }),
        setError,
      );
    },
    [queryClient],
  );

  if (isLoading) {
    return <p className="text-xs text-text-muted">Loading providers...</p>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</p>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddCustom}
          className="gap-1 border-[var(--border)] text-[var(--text-secondary)] hover:bg-white/5"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Custom Agent
        </Button>
        <button
          type="button"
          onClick={handleResetArgs}
          className="flex items-center gap-1 text-[9px] text-text-muted hover:text-text-secondary"
          title="Reset all arguments to defaults"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>

      {/* Grid of cards */}
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-2 2xl:grid-cols-3">
        {allProviders.map((p, i) => (
          <ProviderCard
            key={p.id}
            provider={p}
            // biome-ignore lint/style/noNonNullAssertion: bounds checked by i > 0 / i < length - 1
            onMoveUp={i > 0 ? () => handleSwap(p.id, allProviders[i - 1]!.id) : undefined}
            onMoveDown={
              i < allProviders.length - 1
                ? // biome-ignore lint/style/noNonNullAssertion: bounds checked
                  () => handleSwap(p.id, allProviders[i + 1]!.id)
                : undefined
            }
            onRemove={!p.isBuiltin ? () => handleRemoveCustom(p.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
