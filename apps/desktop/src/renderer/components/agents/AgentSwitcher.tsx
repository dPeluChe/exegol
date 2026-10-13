import type { AgentProvider } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { isLaunchable } from "../../hooks/use-providers";
import { AgentIcon } from "../common/AgentIcon";

/** The other agents in the order the switcher numbers them: installed first */
export function switchTargets(providers: AgentProvider[], selectedId: string): AgentProvider[] {
  const others = providers.filter((p) => p.id !== selectedId && p.id !== "shell");
  return [...others.filter(isLaunchable), ...others.filter((p) => !isLaunchable(p))];
}

/** T204: the picked agent with the others behind a toggle; switching keeps the rest of the form.
 *  Open, 1-9 pick from the row and Esc closes it */
export function AgentSwitcher({
  providers,
  selectedId,
  onChoose,
  suffix,
}: {
  providers: AgentProvider[];
  selectedId: string;
  onChoose: (id: string) => void;
  /** After the name: "in <folder>" */
  suffix?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = providers.find((p) => p.id === selectedId);
  const others = switchTargets(providers, selectedId);
  const choose = (id: string) => {
    onChoose(id);
    setOpen(false);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      return;
    }
    const target = /^[1-9]$/.test(e.key) ? others[Number(e.key) - 1] : undefined;
    if (target) {
      e.preventDefault();
      choose(target.id);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keys for the row's buttons, which hold the focus
    <div className="flex min-w-0 flex-col gap-1.5" onKeyDown={onKeyDown}>
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={
            open ? "Hide the other agents" : "Switch agent (keeps the folder, prompt and mode)"
          }
          className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-white/5"
        >
          {current && (
            <AgentIcon
              provider={current.id}
              size={18}
              fallback={current.icon}
              fallbackColor={current.color}
            />
          )}
          <span className="truncate text-sm font-semibold text-text-primary">
            {current?.name ?? "Select an agent"}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-text-muted transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
        {suffix && <span className="truncate text-sm text-text-muted">{suffix}</span>}
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-1">
          {others.map((p, i) => {
            const missing = !isLaunchable(p);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => choose(p.id)}
                title={
                  missing ? `${p.name} is not installed on this machine` : `${p.name} (${i + 1})`
                }
                className={cn(
                  "relative flex items-center gap-1 rounded-md border border-border bg-bg-secondary px-1.5 py-1 text-[10px] text-text-secondary transition-colors hover:border-accent/50",
                  missing && "opacity-50",
                )}
              >
                <AgentIcon provider={p.id} size={14} fallback={p.icon} fallbackColor={p.color} />
                {p.name}
                {i < 9 && (
                  <span className="rounded bg-bg-tertiary px-0.5 text-[8px] text-text-muted">
                    {i + 1}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
