import { type AgentStatus, LIVE_STATUSES } from "@exegol/shared";
import { isPasteTarget } from "../../lib/agent-input";

/** A live session that can receive a selection, with the project it belongs to */
export interface SendTarget {
  id: string;
  name: string;
  /** "shell" for a terminal at its prompt (shown with the terminal icon) */
  cliType: string;
  projectId: string;
  /** Shells: the folder's basename, when the shell reported one */
  folder?: string;
}

export interface SendGroup {
  projectId: string;
  projectName: string;
  targets: SendTarget[];
}

/** The source pane's own project (null when nothing else is there), then every other project */
export interface SendSections {
  own: SendGroup | null;
  others: SendGroup[];
}

interface SessionLike {
  id: string;
  alias?: string | null;
  cliType: string;
  projectId: string;
  status: AgentStatus;
  launchedInShell?: boolean;
  archived?: boolean;
  suspended?: boolean;
}

/** A plain terminal, or one whose typed CLI exited back to the prompt */
const atShellPrompt = (a: SessionLike) =>
  a.cliType === "shell" || (!!a.launchedInShell && a.status === "idle");

const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

function toTarget(a: SessionLike, folders: ReadonlyMap<string, string>): SendTarget | null {
  if (atShellPrompt(a)) {
    if (!LIVE_STATUSES.has(a.status) || a.archived || a.suspended) return null;
    const cwd = folders.get(a.id);
    return {
      id: a.id,
      name: a.alias ?? "Terminal",
      cliType: "shell",
      projectId: a.projectId,
      ...(cwd ? { folder: basename(cwd) } : {}),
    };
  }
  if (!isPasteTarget(a)) return null;
  return { id: a.id, name: a.alias ?? a.cliType, cliType: a.cliType, projectId: a.projectId };
}

/** Live agents and terminals other than `selfId`. Other projects follow the sidebar's drag order
 *  (`projectOrder`), then name. `folders`: a shell's working folder by session id */
export function buildSendSections(
  sessions: SessionLike[],
  selfId: string,
  projectNames: Map<string, string>,
  ownProjectId: string | undefined,
  projectOrder: readonly string[] = [],
  folders: ReadonlyMap<string, string> = new Map(),
): SendSections {
  const targets = sessions
    .filter((a) => a.id !== selfId)
    .map((a) => toTarget(a, folders))
    .filter((t): t is SendTarget => t !== null);
  const nameOf = (id: string) => projectNames.get(id) ?? id.slice(0, 8);
  const groupOf = (id: string): SendGroup => ({
    projectId: id,
    projectName: nameOf(id),
    targets: targets.filter((t) => t.projectId === id),
  });
  const rank = (id: string) => {
    const i = projectOrder.indexOf(id);
    return i === -1 ? projectOrder.length : i;
  };
  const others = [...new Set(targets.map((t) => t.projectId))]
    .filter((id) => id !== ownProjectId)
    .sort((a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b)))
    .map(groupOf);
  const own = ownProjectId ? groupOf(ownProjectId) : null;
  return { own: own && own.targets.length > 0 ? own : null, others };
}

export const hasSendTargets = (s: SendSections) => s.own !== null || s.others.length > 0;

/** Settings > Terminal: press Enter after a Send to, per target kind (both off: paste only) */
export interface SendEnterPrefs {
  sendToRunTerminal: boolean;
  sendToSubmitAgent: boolean;
}

/** paste: text only. enter: text, then Enter. held: Enter wanted, but the agent is asking a
 *  question that an Enter would answer */
export type SendAction = "paste" | "enter" | "held";

export function sendAction(
  target: Pick<SendTarget, "cliType">,
  prefs: SendEnterPrefs,
  asksQuestion: boolean,
): SendAction {
  if (target.cliType === "shell") return prefs.sendToRunTerminal ? "enter" : "paste";
  if (!prefs.sendToSubmitAgent) return "paste";
  return asksQuestion ? "held" : "enter";
}

/** The Send to list's footer: what a pick does with these settings */
export function sendHint(prefs: SendEnterPrefs): string {
  if (prefs.sendToRunTerminal && prefs.sendToSubmitAgent) return "Pastes and presses Enter";
  if (prefs.sendToRunTerminal) return "Pastes; runs it in terminals";
  if (prefs.sendToSubmitAgent) return "Pastes; submits it to agents";
  return "Pastes only";
}
