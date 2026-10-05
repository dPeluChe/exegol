import { isHostAllowed } from "@exegol/shared";

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

/** Cookies of the old shared session a project's new partition inherits: the hosts its agents may
 *  open (local ones and its allowlist), unexpired */
export function selectCookiesToCopy(
  cookies: readonly StoredCookie[],
  allowedHosts: readonly string[],
  nowSec: number,
): StoredCookie[] {
  return cookies.filter((c) => {
    const host = (c.domain ?? "").replace(/^\./, "");
    if (!host || !c.name) return false;
    if (!c.session && c.expirationDate !== undefined && c.expirationDate <= nowSec) return false;
    return isHostAllowed(host, allowedHosts);
  });
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
