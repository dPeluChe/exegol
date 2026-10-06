import { hostMatches, isHostAllowed, type NeedsUserKind } from "@exegol/shared";

export interface PageSignals {
  url: string;
  /** Last main-frame HTTP status, when known */
  httpStatus?: number | null;
  hasPasswordField: boolean;
  hasCaptcha: boolean;
  /** A log out / sign out control: the user is already in, a password field is something else */
  loggedIn?: boolean;
}

export interface NeedsUser {
  host: string;
  reason: NeedsUserKind;
  message: string;
}

const SSO_HOSTS = [
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "appleid.apple.com",
  "*.auth0.com",
  "*.okta.com",
  "*.onelogin.com",
  "*.accounts.dev",
  "*.workos.com",
];
const SSO_PATH = /\/(oauth2?|sso|saml|openid-connect|authorize|signin-oidc|login\/oauth)(\/|$)/i;
const AUTH_PATH = /\/(login|log-in|signin|sign-in|sign_in|session\/new)(\/|$)/i;

/** A page the agent must hand to the user: a captcha, an SSO or OAuth step, a page outside the
 *  project's hosts (an auth redirect), a login page, or a 401/403 */
export function detectNeedsUser(
  signals: PageSignals,
  allowedHosts: readonly string[],
): NeedsUser | null {
  let url: URL;
  try {
    url = new URL(signals.url);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname;
  if (signals.hasCaptcha) return { host, reason: "captcha", message: `a captcha at ${host}` };
  if (SSO_HOSTS.some((p) => hostMatches(host, p)) || SSO_PATH.test(url.pathname)) {
    return { host, reason: "sso", message: `a sign-in (SSO/OAuth) at ${host}` };
  }
  if (!isHostAllowed(host, allowedHosts)) {
    return { host, reason: "outside_allowlist", message: `${host}, outside the allowed hosts` };
  }
  // A password field alone is not a login page: settings pages of a logged-in user have them
  const loginPage = (signals.hasPasswordField && !signals.loggedIn) || AUTH_PATH.test(url.pathname);
  if (loginPage) return { host, reason: "login", message: `a login page at ${host}` };
  if (signals.httpStatus === 401) {
    return { host, reason: "http_401", message: `401 Unauthorized at ${host}` };
  }
  if (signals.httpStatus === 403) {
    return { host, reason: "http_403", message: `403 Forbidden at ${host}` };
  }
  return null;
}
