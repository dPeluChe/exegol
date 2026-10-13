import type { AgentStatus } from "@exegol/shared";

/** What an ended session's pane offers; `reopen` is a shell's own Resume */
export type EndedAction =
  | "resume"
  | "restart"
  | "reopen"
  | "new"
  | "terminal"
  | "files"
  | "browser";

export interface EndedContext {
  isShell: boolean;
  /** The CLI can continue the conversation (resumableCliTypes) */
  canResume: boolean;
  /** Shown in a workspace pane: new sessions and conversions need one to land in */
  hasPane: boolean;
}

/** The primary action first, then the launcher's; a shell's terminal is its Reopen */
export function endedActions({ isShell, canResume, hasPane }: EndedContext): EndedAction[] {
  const primary: EndedAction = isShell ? "reopen" : canResume ? "resume" : "restart";
  if (!hasPane) return [primary];
  return isShell ? [primary, "files", "browser"] : [primary, "new", "terminal", "files", "browser"];
}

export const ENDED_ACTION_KEYS: Record<EndedAction, string> = {
  resume: "R",
  restart: "R",
  reopen: "R",
  new: "N",
  terminal: "T",
  files: "F",
  browser: "B",
};

/** T reopens a shell too: in a shell pane it is the same thing */
const KEY_ACTIONS: Record<string, EndedAction[]> = {
  r: ["resume", "restart", "reopen"],
  n: ["new"],
  t: ["terminal", "reopen"],
  f: ["files"],
  b: ["browser"],
};

export type EndedKey = { action: EndedAction } | { agentIndex: number };

/** A launcher key of the ended pane, with no field taking the typing; 1-9 pick the switcher's agents */
export function endedKeyAction(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "repeat">,
  typing: boolean,
  actions: EndedAction[],
  agentCount: number,
): EndedKey | null {
  if (typing || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (/^[1-9]$/.test(key)) {
    const index = Number(key) - 1;
    return index < agentCount ? { agentIndex: index } : null;
  }
  const action = KEY_ACTIONS[key]?.find((a) => actions.includes(a));
  return action ? { action } : null;
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** The folder's name when it is not the project root (a worktree, a shell's subfolder) */
export function folderLabel(
  folder: string | null | undefined,
  projectPath: string | null | undefined,
): string | null {
  if (!folder) return null;
  const f = trimSlash(folder);
  if (projectPath && f === trimSlash(projectPath)) return null;
  return f.slice(f.lastIndexOf("/") + 1) || f;
}

/** "Claude Code ended", the session's name, "project / folder" */
export function endedHeader({
  cliName,
  name,
  projectName,
  folder,
  suspended,
}: {
  cliName: string;
  name?: string | null;
  projectName?: string | null;
  folder?: string | null;
  suspended?: boolean;
}): string[] {
  const where = [projectName, folder].filter(Boolean).join(" / ");
  return [`${cliName} ${suspended ? "suspended" : "ended"}`, name ?? "", where].filter(Boolean);
}

/** The small status chip: "completed · exit 0" */
export function statusChipText(
  status: AgentStatus,
  exitCode?: number | null,
  suspended?: boolean,
): string {
  const label = suspended ? "suspended" : status.replace("_", " ");
  return exitCode == null ? label : `${label} · exit ${exitCode}`;
}

export const PRIMARY_LABEL: Record<"resume" | "restart" | "reopen", string> = {
  resume: "Resume",
  restart: "Restart",
  reopen: "Reopen terminal here",
};
