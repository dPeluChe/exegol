import type { Colab, InboxThread } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Inbox, Plus, User, Users } from "lucide-react";
import { ALL_THREADS, channelPending, PERSONAL } from "../../../lib/colab-channels";
import { LABEL_CLASS } from "../../agents/SpawnOptions";
import { HEAD_BUTTON } from "../InboxMenuList";

function Channel({
  icon: Icon,
  name,
  pending,
  selected,
  onPick,
}: {
  icon: typeof Inbox;
  name: string;
  pending: { count: number; needsYou: boolean };
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected}
      onClick={onPick}
      title={pending.needsYou ? `${name}: a thread needs you` : name}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
        selected ? "bg-white/10 text-text-primary" : "text-text-secondary hover:bg-white/5",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {pending.count > 0 && (
        <span
          className={cn(
            "shrink-0 text-[10px] tabular-nums",
            pending.needsYou ? "text-warning" : "text-text-muted",
          )}
        >
          {pending.count}
        </span>
      )}
    </button>
  );
}

/** The lists of the Colabs tab, as channels: every thread, the person's own, then each colab
 *  with how many of its threads are pending */
export function ColabChannels({
  colabs,
  active,
  channel,
  onPick,
  onNew,
  onHelp,
}: {
  colabs: Colab[];
  active: InboxThread[];
  channel: string;
  onPick: (channel: string) => void;
  onNew: () => void;
  /** Absent while the steps are on screen */
  onHelp?: () => void;
}) {
  const row = (id: string, name: string, icon: typeof Inbox) => (
    <Channel
      key={id}
      icon={icon}
      name={name}
      pending={channelPending(active, id)}
      selected={channel === id}
      onPick={() => onPick(id)}
    />
  );
  return (
    <nav aria-label="Inboxes" className="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto">
      {row(ALL_THREADS, "All threads", Inbox)}
      {row(PERSONAL, "Personal", User)}
      <div className={cn("mt-3 mb-1 flex items-center px-2", LABEL_CLASS)}>
        Colabs
        <button
          type="button"
          onClick={onNew}
          className={cn("ml-auto normal-case tracking-normal", HEAD_BUTTON)}
        >
          <Plus className="h-3 w-3" />
          New
        </button>
      </div>
      {colabs.length === 0 && (
        <p className="px-2 text-[11px] text-text-muted">
          None yet. Create one to join two projects.
        </p>
      )}
      {colabs.map((c) => row(c.id, c.name, Users))}
      {onHelp && (
        <button type="button" onClick={onHelp} className={cn("mt-3 self-start", HEAD_BUTTON)}>
          How colabs work
        </button>
      )}
    </nav>
  );
}
