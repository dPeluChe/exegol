import { type CliUpdateStatus, LIVE_STATUSES } from "@exegol/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState } from "react";
import { restartNeeded, updateAndRestart, useCliUpdates } from "../../hooks/use-cli-updates";
import { useEnabledProviders } from "../../hooks/use-providers";
import { useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { useCliRestartStore } from "../../stores/cli-restarts";
import { AgentIcon } from "../common/AgentIcon";
import { SessionChips } from "../common/SessionChips";

const DISMISSED_KEY = "exegol.cliUpdates.dismissed";

interface Row {
  status: CliUpdateStatus;
  /** Its live sessions, and those already behind an installed update */
  sessions: string[];
  behind: string[];
}

/** One line per CLI in use: an update to install, or sessions still on an older version */
export function cliUpdateRows(
  statuses: Map<string, CliUpdateStatus>,
  agents: {
    id: string;
    cliType: string;
    status: string;
    cliVersion?: string | null;
    startedAt?: number | null;
  }[],
): Row[] {
  return [...statuses.values()]
    .map((status) => {
      const live = agents.filter(
        (a) => a.cliType === status.cliType && LIVE_STATUSES.has(a.status as never),
      );
      return {
        status,
        sessions: live.map((a) => a.id),
        behind: live.filter((a) => restartNeeded(a, status)).map((a) => a.id),
      };
    })
    .filter((r) => (r.status.updateAvailable && r.status.updateCommand) || r.behind.length > 0);
}

/** The versions this notice was dismissed for: it comes back only for newer ones. Not the
 *  session count: restarting one session from its pane changed it and reopened the notice */
export const rowsKey = (rows: Pick<Row, "status">[]) =>
  rows
    .map((r) => `${r.status.cliType}@${r.status.latest ?? r.status.installed}`)
    .sort()
    .join(",");

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** After startup (never in the splash: the check needs the network, and updates can ask for a
 *  password): the CLIs in use with an update, and one step to install them and restart their
 *  sessions as each one is free, keeping conversation, model, YOLO, mode and name */
export function CliUpdatesNotice() {
  const statuses = useCliUpdates();
  const agents = useAgentStore((s) => s.agents);
  const providers = useEnabledProviders();
  const nameOf = (cliType: string) => providers.find((p) => p.id === cliType)?.name ?? cliType;
  const rows = cliUpdateRows(statuses, Object.values(agents));
  const key = rowsKey(rows);
  const [closedKey, setClosedKey] = useState<string | null>(readDismissed);
  const open = rows.length > 0 && key !== closedKey;

  const close = () => {
    setClosedKey(key);
    try {
      localStorage.setItem(DISMISSED_KEY, key);
    } catch {
      /* the notice just comes back next launch */
    }
  };

  const toUpdate = rows.filter((r) => r.status.updateAvailable && r.status.updateCommand);
  const behind = rows.flatMap((r) => r.behind);

  const apply = () => {
    const restarts = useCliRestartStore.getState();
    for (const id of behind) restarts.request(id);
    if (toUpdate.length > 0) {
      const projectId =
        useAppStore.getState().activeProjectId ?? agents[toUpdate[0]?.sessions[0] ?? ""]?.projectId;
      if (projectId) {
        updateAndRestart(
          projectId,
          toUpdate.map((r) => r.status.updateCommand ?? ""),
          toUpdate.flatMap((r) => r.sessions.filter((id) => !behind.includes(id))),
        ).catch((err) => console.error("[CliUpdates] Update failed to start:", err));
      }
    }
    close();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-[15%] z-50 flex w-full max-w-md -translate-x-1/2 flex-col gap-3 rounded-xl border border-border bg-bg-secondary p-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold text-text-primary">
              CLI updates
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="rounded p-1 text-text-muted hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </Dialog.Close>
          </div>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.status.cliType} className="text-[11px]">
                <div className="flex items-center gap-2">
                  <AgentIcon provider={r.status.cliType} size={16} />
                  <span className="font-medium text-text-primary">{nameOf(r.status.cliType)}</span>
                  <span className="text-text-muted">
                    {r.status.updateAvailable
                      ? `${r.status.installed ?? "?"} → ${r.status.latest}`
                      : `${r.status.installed} installed`}
                    {" · "}
                    {r.behind.length > 0
                      ? `${r.behind.length} session${r.behind.length > 1 ? "s" : ""} on an older version`
                      : `${r.sessions.length} session${r.sessions.length > 1 ? "s" : ""}`}
                  </span>
                </div>
                <div className="mt-1 pl-6">
                  <SessionChips
                    sessions={(r.behind.length > 0 ? r.behind : r.sessions).flatMap((id) =>
                      agents[id] ? [agents[id]] : [],
                    )}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-text-muted">
            {toUpdate.length > 0
              ? "The updates run in a new tab (answer there if one asks for a password). "
              : ""}
            Each session restarts on the new version when its turn ends and resumes its conversation
            with the same model, YOLO, mode and name.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-white/5"
            >
              Later
            </button>
            <button
              type="button"
              onClick={apply}
              className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-accent/90"
            >
              {toUpdate.length > 0 ? "Update and restart" : "Restart sessions"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
