import { hostOf, isOutsideAllowlist } from "@exegol/shared";

/** While an agent drives a pane, its page may only reach local hosts and the project's allowlist:
 *  a script it ran (or a page it opened) cannot carry the project's data anywhere else */
export function blocksAgentRequest(
  url: string,
  agentActing: boolean,
  allowedHosts: readonly string[],
): boolean {
  return agentActing && isOutsideAllowlist(url, allowedHosts);
}

/** A request URL as the network log keeps it: another site's query string and fragment (tokens,
 *  emails, tracking ids) are cut */
export function logUrl(url: string, pageHost: string | null | undefined): string {
  if (pageHost && hostOf(url) === pageHost) return url;
  return url.replace(/[?#].*$/s, "");
}
