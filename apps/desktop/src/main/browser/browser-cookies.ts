import { session } from "electron";
import type Database from "libsql";
import { listProjects } from "../db/queries/projects";
import { getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { logger } from "../lib/logger";
import { projectsToMigrate, selectCookiesToCopy, toSetDetails } from "./cookie-migration";
import { projectSession } from "./pane-registry";

/** Projects whose partition got the one-time copy (or were created after it) */
const COOKIES_MIGRATED_KEY = "browser_partition_cookies_migrated";
/** Set once the one-time upgrade copy ran: it never runs again */
const COOKIES_UPGRADE_DONE_KEY = "browser_partition_cookies_upgrade_done";

async function copyCookies(
  projectId: string,
  scope: { local: boolean; hosts: readonly string[] },
): Promise<number> {
  const all = await session.defaultSession.cookies.get({});
  const picked = selectCookiesToCopy(all, scope, Date.now() / 1000);
  const target = projectSession(projectId);
  // allSettled: one bad cookie must not stop the rest
  const results = await Promise.allSettled(
    picked.map((cookie) => target.cookies.set(toSetDetails(cookie))),
  );
  return results.filter((r) => r.status === "fulfilled").length;
}

/** Hosts just added to a project's allowlist bring their logins from the old shared session */
export async function copyCookiesForHosts(projectId: string, hosts: string[]): Promise<void> {
  if (hosts.length === 0) return;
  const copied = await copyCookies(projectId, { local: false, hosts });
  if (copied > 0) logger.info(`[AgentBrowser] Copied ${copied} cookies for newly allowed hosts`);
}

/** A project created after the upgrade starts with an empty partition: never part of the copy */
export function markCookiesMigrated(db: Database.Database, projectId: string): void {
  const done = getJsonSetting<string[]>(db, COOKIES_MIGRATED_KEY, []);
  if (!done.includes(projectId)) setJsonSetting(db, COOKIES_MIGRATED_KEY, [...done, projectId]);
}

/** Once, on the upgrade: the projects that shared the default session get its local-host
 *  cookies (and their allowlist's) in their own partition, so nobody logs in again */
export async function migrateBrowserCookies(db: Database.Database): Promise<void> {
  const state = {
    done: getJsonSetting<boolean>(db, COOKIES_UPGRADE_DONE_KEY, false),
    migrated: getJsonSetting<string[]>(db, COOKIES_MIGRATED_KEY, []),
  };
  const projects = listProjects(db);
  const pending = projectsToMigrate(
    projects.map((p) => p.id),
    state,
  );
  const migrated = new Set(state.migrated);
  for (const project of projects) {
    if (!pending.includes(project.id)) continue;
    const copied = await copyCookies(project.id, {
      local: true,
      hosts: project.browserHosts ?? [],
    });
    migrated.add(project.id);
    if (copied > 0) logger.info(`[AgentBrowser] Copied ${copied} cookies into a project partition`);
  }
  setJsonSetting(db, COOKIES_MIGRATED_KEY, [...migrated]);
  setJsonSetting(db, COOKIES_UPGRADE_DONE_KEY, true);
}
