import { isHostAllowed } from "@exegol/shared";

export interface PageSignals {
  url: string;
  /** Last main-frame HTTP status, when known */
  httpStatus?: number | null;
  hasPasswordField: boolean;
  hasCaptcha: boolean;
}

export interface NeedsUser {
  host: string;
  reason: "login" | "sso" | "captcha" | "http_401" | "http_403" | "outside_allowlist";
  message: string;
}

const SSO_HOSTS = [
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "appleid.apple.com",
  "auth0.com",
  "okta.com",
  "onelogin.com",
  "accounts.dev",
  "workos.com",
];
const SSO_PATH = /\/(oauth2?|sso|saml|openid-connect|authorize|signin-oidc|login\/oauth)(\/|$)/i;

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** A page the agent must hand to the user: a captcha, an SSO or OAuth step, a page outside the
 *  project's hosts (an auth redirect), a login form, or a 401/403 */
export function detectNeedsUser(
  signals: PageSignals,
  allowedHosts: readonly string[],
): NeedsUser | null {
  const url = parse(signals.url);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
  const host = url.hostname;
  if (signals.hasCaptcha) return { host, reason: "captcha", message: `a captcha at ${host}` };
  const ssoHost = SSO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (ssoHost || SSO_PATH.test(url.pathname)) {
    return { host, reason: "sso", message: `a sign-in (SSO/OAuth) at ${host}` };
  }
  if (!isHostAllowed(host, allowedHosts)) {
    return { host, reason: "outside_allowlist", message: `${host}, outside the allowed hosts` };
  }
  if (signals.hasPasswordField) {
    return { host, reason: "login", message: `a login form at ${host}` };
  }
  if (signals.httpStatus === 401) {
    return { host, reason: "http_401", message: `401 Unauthorized at ${host}` };
  }
  if (signals.httpStatus === 403) {
    return { host, reason: "http_403", message: `403 Forbidden at ${host}` };
  }
  return null;
}
