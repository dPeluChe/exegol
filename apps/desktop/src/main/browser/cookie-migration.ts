import { hostMatches, isLocalHost } from "@exegol/shared";

/** The fields of Electron's Cookie this needs (kept structural so it is testable) */
export interface StoredCookie {
  name: string;
  value: string;
  domain?: string;
  hostOnly?: boolean;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  expirationDate?: number;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

export interface CookieSetDetails {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

/** Cookies of the old shared session a project's partition inherits, unexpired. `local`: the local
 *  hosts too (only the one-time upgrade copy: later, one project's localhost logins stay its own).
 *  `hosts`: allowlist entries; a parent-domain cookie (.app.com) counts for staging.app.com */
export function selectCookiesToCopy(
  cookies: readonly StoredCookie[],
  scope: { local: boolean; hosts: readonly string[] },
  nowSec: number,
): StoredCookie[] {
  return cookies.filter((c) => {
    const host = (c.domain ?? "").replace(/^\./, "").toLowerCase();
    if (!host || !c.name) return false;
    if (!c.session && c.expirationDate !== undefined && c.expirationDate <= nowSec) return false;
    if (isLocalHost(host)) return scope.local;
    return scope.hosts.some((p) => {
      if (hostMatches(host, p)) return true;
      const base = p.replace(/^\*\./, "");
      return !c.hostOnly && base.endsWith(`.${host}`);
    });
  });
}

/** Upgrade gate: the one-time copy runs while the global flag is unset, and only for projects
 *  that existed before it (ones created after are marked migrated at creation) */
export function projectsToMigrate(
  projectIds: readonly string[],
  state: { done: boolean; migrated: readonly string[] },
): string[] {
  if (state.done) return [];
  return projectIds.filter((id) => !state.migrated.includes(id));
}

/** `cookies.set` input that recreates the cookie as it was (host-only cookies carry no domain) */
export function toSetDetails(c: StoredCookie): CookieSetDetails {
  const host = (c.domain ?? "").replace(/^\./, "");
  const details: CookieSetDetails = {
    url: `${c.secure ? "https" : "http"}://${host}${c.path ?? "/"}`,
    name: c.name,
    value: c.value,
    path: c.path ?? "/",
    secure: c.secure ?? false,
    httpOnly: c.httpOnly ?? false,
  };
  if (!c.hostOnly && c.domain) details.domain = c.domain;
  if (!c.session && c.expirationDate !== undefined) details.expirationDate = c.expirationDate;
  if (c.sameSite) details.sameSite = c.sameSite;
  return details;
}
