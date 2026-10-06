// Agent browser: which pages an agent may drive, and the pane state the UI shows.

/** Each project's browser panes share one persistent session (logins), no other project's */
export const browserPartitionFor = (projectId: string): string => `persist:project-${projectId}`;

const PARTITION_RE = /^persist:project-([A-Za-z0-9_-]{1,64})$/;

export function projectIdFromPartition(partition: string | undefined | null): string | null {
  return partition?.match(PARTITION_RE)?.[1] ?? null;
}

export const MAX_BROWSER_HOSTS = 50;

/** What agents may always open, as browser_list and the refusals show it. `.local` (mDNS) names
 *  can be other machines on the network, so they go in the allowlist like any other host */
export const LOCAL_HOST_PATTERNS = ["localhost", "127.0.0.1", "[::1]", "*.localhost"] as const;

/** localhost, 127.0.0.0/8, [::1], 0.0.0.0, *.localhost */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return h.endsWith(".localhost");
}

/** Hostname of a URL, or null when it does not parse or has none */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** One allowlist entry as typed ("https://staging.app.com/x", "*.app.com") to a host pattern, or
 *  null when it is not a host */
export function normalizeHostEntry(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.replace(/:\d+$/, "");
  const wildcard = s.startsWith("*.");
  const host = wildcard ? s.slice(2) : s;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || host.length > 253) return null;
  return wildcard ? `*.${host}` : host;
}

/** Textarea or array input to a clean, deduped list (invalid entries dropped) */
export function parseBrowserHosts(input: string | readonly string[]): string[] {
  const parts = typeof input === "string" ? input.split(/[\s,]+/) : input;
  const out: string[] = [];
  for (const p of parts) {
    const h = normalizeHostEntry(p);
    if (h && !out.includes(h)) out.push(h);
  }
  return out.slice(0, MAX_BROWSER_HOSTS);
}

/** Exact host, or a `*.domain` entry: the domain itself and any subdomain */
export function hostMatches(hostname: string, pattern: string): boolean {
  const h = hostname.toLowerCase();
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return h === base || h.endsWith(`.${base}`);
  }
  return h === pattern;
}

export function isHostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  return isLocalHost(hostname) || allowedHosts.some((p) => hostMatches(hostname, p));
}

/** A web URL (http, https, ws, wss) whose host is neither local nor allowed. Other schemes (data:,
 *  blob:, about:) carry nothing off the machine and are not "outside" */
export function isOutsideAllowlist(url: string, allowedHosts: readonly string[]): boolean {
  if (!/^(https?|wss?):/i.test(url)) return false;
  const h = hostOf(url);
  return h !== null && !isHostAllowed(h, allowedHosts);
}

export type UrlCheck = { ok: true; url: string; host: string } | { ok: false; reason: string };

/** An agent may open http(s) pages on local hosts and the project's allowlist; nothing else */
export function checkAgentUrl(raw: string, allowedHosts: readonly string[]): UrlCheck {
  const text = raw.trim();
  let url: URL;
  try {
    // "localhost:3000" parses as a scheme: only "x://" or a scheme with no host part is one
    const hasScheme =
      /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ||
      /^(javascript|data|file|about|blob|vbscript|mailto|chrome|devtools|view-source):/i.test(text);
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return { ok: false, reason: `not a valid URL: ${text.slice(0, 200)}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      reason: `${url.protocol} URLs are blocked for agents: only http and https pages`,
    };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with credentials are blocked: ask the user to log in" };
  }
  if (!isHostAllowed(url.hostname, allowedHosts)) {
    return {
      ok: false,
      reason:
        `${url.hostname} is not allowed for agents in this project. Only local hosts ` +
        `(${LOCAL_HOST_PATTERNS.join(", ")}) and the project's allowlist are. ` +
        "Ask the user to add it in Edit project > Agent browser hosts, or to open it themselves.",
    };
  }
  return { ok: true, url: url.toString(), host: url.hostname };
}

/** What a browser pane shows about the agent driving it (main pushes, renderer draws) */
export interface AgentBrowserPaneState {
  paneId: string;
  projectId: string;
  agentId: string | null;
  alias: string | null;
  /** Acted in the last few seconds, or waiting on the user */
  active: boolean;
  lastActionAt: number | null;
  userHasControl: boolean;
  /** browser_wait_for_user: what the agent asked the user to do */
  waitingReason: string | null;
  /** A login, SSO, captcha or 401/403 the agent stopped at */
  needsUserHost: string | null;
  needsUserKind: NeedsUserKind | null;
  /** The pane's webview is gone: drop it */
  closed?: boolean;
}

export type NeedsUserKind =
  | "login"
  | "sso"
  | "captcha"
  | "http_401"
  | "http_403"
  | "outside_allowlist";

/** What the user is asked to do, for the banner, the attention item and the notification */
export function needsUserReason(
  s: Pick<AgentBrowserPaneState, "waitingReason" | "needsUserHost" | "needsUserKind">,
): string | null {
  if (s.waitingReason) return s.waitingReason;
  const host = s.needsUserHost;
  if (!host) return null;
  if (s.needsUserKind === "captcha") return `solve a captcha at ${host}`;
  if (s.needsUserKind === "outside_allowlist") {
    return `take over at ${host} (outside the agent's allowed hosts)`;
  }
  return `log in at ${host}`;
}

export type McpAgentState = "connected" | "not_connected" | "not_wired";

export interface McpStatusEvent {
  /** Live agents only; shells are not listed */
  agents: Record<string, McpAgentState>;
}
