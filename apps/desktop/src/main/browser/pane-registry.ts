import { browserPartitionFor } from "@exegol/shared";
import { session, type WebContents } from "electron";
import type Database from "libsql";
import { withTimeout } from "../lib/timeout";
import { ExegolToolError } from "../mcp/exegol-protocol";
import { isAgentActing } from "./control";
import { allowedHostsOf } from "./tool-guards";
import { isPage } from "./webview-guard";

/** Our own isolated world in the page: refs live there, out of the page's reach */
export const AGENT_WORLD_ID = 1337;
export const ISOLATED_TIMEOUT_MS = 10_000;

export interface Registered {
  paneId: string;
  projectId: string;
  wcId: number;
}

const registered = new Map<string, Registered>();

export const addPane = (r: Registered): void => {
  registered.set(r.paneId, r);
};

export const paneById = (paneId: string): Registered | undefined => registered.get(paneId);

export const panesOfProject = (projectId: string): Registered[] =>
  [...registered.values()].filter((r) => r.projectId === projectId);

/** The panes a destroyed webview held */
export function removePanesOf(wcId: number): string[] {
  const gone = [...registered.values()].filter((r) => r.wcId === wcId).map((r) => r.paneId);
  for (const paneId of gone) registered.delete(paneId);
  return gone;
}

let dbRef: Database.Database | null = null;

export function setPaneRegistryDb(db: Database.Database): void {
  dbRef = db;
}

export const toolTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  withTimeout(p, ms, () => new ExegolToolError(`${what} timed out`, -32027));

export const projectSession = (projectId: string) =>
  session.fromPartition(browserPartitionFor(projectId));

/** A webview the given window hosts (the check every renderer-supplied webContents id goes
 *  through) */
export function isHostedWebview(
  wc: WebContents | undefined | null,
  host: WebContents,
): wc is WebContents {
  return isPage(wc) && wc.hostWebContents === host;
}

/** The webview runs in this project's own partition: the check every agent call goes through */
export function inProjectPartition(wc: WebContents, projectId: string): boolean {
  return isPage(wc) && wc.session === projectSession(projectId);
}

export const paneHostsOf = (projectId: string): string[] =>
  dbRef ? allowedHostsOf(dbRef, projectId) : [];

export function paneOfWebContents(wcId: number): Registered | undefined {
  for (const r of registered.values()) if (r.wcId === wcId) return r;
  return undefined;
}

/** An agent is driving this webview (or, for a request with no webview, any pane of the project) */
export function agentActingOn(projectId: string, wcId: number | undefined): boolean {
  if (wcId !== undefined) {
    const r = paneOfWebContents(wcId);
    return !!r && isAgentActing(r.paneId);
  }
  for (const r of registered.values()) {
    if (r.projectId === projectId && isAgentActing(r.paneId)) return true;
  }
  return false;
}
