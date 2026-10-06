import { describe, expect, it } from "vitest";
import {
  browserPartitionFor,
  checkAgentUrl,
  hostOf,
  isHostAllowed,
  isLocalHost,
  isOutsideAllowlist,
  needsUserReason,
  normalizeHostEntry,
  parseBrowserHosts,
  projectIdFromPartition,
} from "./agent-browser";
import { pickDevServerPort } from "./dev-servers";

describe("agent browser URL policy", () => {
  it("allows local hosts by default", () => {
    for (const url of [
      "http://localhost:3000/a",
      "http://127.0.0.1:5173",
      "http://[::1]:8080/",
      "https://app.localhost",
    ]) {
      expect(checkAgentUrl(url, []).ok, url).toBe(true);
    }
  });

  it("refuses other hosts with a message telling the agent to ask the user", () => {
    const r = checkAgentUrl("https://example.com/login", []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Ask the user/);
  });

  it("allows the project's allowlist, exact and wildcard", () => {
    const hosts = ["staging.myapp.com", "*.myapp.dev"];
    expect(checkAgentUrl("https://staging.myapp.com/x", hosts).ok).toBe(true);
    expect(checkAgentUrl("https://myapp.com", hosts).ok).toBe(false);
    expect(checkAgentUrl("https://a.b.myapp.dev", hosts).ok).toBe(true);
    expect(checkAgentUrl("https://myapp.dev", hosts).ok).toBe(true);
    expect(checkAgentUrl("https://evilmyapp.dev", hosts).ok).toBe(false);
    expect(checkAgentUrl("https://myapp.dev.evil.com", hosts).ok).toBe(false);
  });

  it("blocks file:, javascript:, data: and credentials in the URL", () => {
    expect(checkAgentUrl("file:///etc/passwd", []).ok).toBe(false);
    expect(checkAgentUrl("javascript:alert(1)", []).ok).toBe(false);
    expect(checkAgentUrl("data:text/html,<b>x</b>", []).ok).toBe(false);
    expect(checkAgentUrl("http://user:pw@localhost:3000", []).ok).toBe(false);
  });

  it("adds http:// to a bare host", () => {
    const r = checkAgentUrl("localhost:3000/path", []);
    expect(r.ok && r.url).toBe("http://localhost:3000/path");
  });

  it("treats .local names as any other host (opt-in via the allowlist)", () => {
    expect(checkAgentUrl("http://my-mac.local:3000", []).ok).toBe(false);
    expect(checkAgentUrl("http://my-mac.local:3000", ["my-mac.local"]).ok).toBe(true);
  });

  it("flags web URLs outside the allowlist, never data: or blob:", () => {
    expect(isOutsideAllowlist("https://evil.com/x?d=1", [])).toBe(true);
    expect(isOutsideAllowlist("wss://evil.com/socket", [])).toBe(true);
    expect(isOutsideAllowlist("https://api.myapp.dev/x", ["*.myapp.dev"])).toBe(false);
    expect(isOutsideAllowlist("http://localhost:3000/api", [])).toBe(false);
    expect(isOutsideAllowlist("data:text/plain,hi", [])).toBe(false);
    expect(isOutsideAllowlist("blob:http://localhost/1", [])).toBe(false);
    expect(hostOf("not a url")).toBeNull();
  });

  it("says what the user is asked to do", () => {
    const base = { waitingReason: null, needsUserHost: "app.com" };
    expect(needsUserReason({ ...base, needsUserKind: "login" })).toBe("log in at app.com");
    expect(needsUserReason({ ...base, needsUserKind: "captcha" })).toMatch(/captcha/);
    expect(needsUserReason({ ...base, waitingReason: "seed data", needsUserKind: null })).toBe(
      "seed data",
    );
    expect(needsUserReason({ waitingReason: null, needsUserHost: null, needsUserKind: null })).toBe(
      null,
    );
  });

  it("picks the preferred port, else a running one", () => {
    const ports = [
      { port: 3000, source: "config" },
      { port: 5173, source: "runtime" },
    ];
    expect(pickDevServerPort(ports, 8080)).toBe(8080);
    expect(pickDevServerPort(ports)).toBe(5173);
    expect(pickDevServerPort([])).toBeUndefined();
  });

  it("does not treat lookalike hosts as local", () => {
    expect(isLocalHost("localhost.evil.com")).toBe(false);
    expect(isLocalHost("127.0.0.1.nip.io")).toBe(false);
    expect(isHostAllowed("notlocalhost", [])).toBe(false);
  });

  it("normalizes allowlist entries typed as URLs", () => {
    expect(normalizeHostEntry("https://Staging.MyApp.com:443/path?q")).toBe("staging.myapp.com");
    expect(normalizeHostEntry("*.myapp.dev")).toBe("*.myapp.dev");
    expect(normalizeHostEntry("not a host")).toBeNull();
    expect(normalizeHostEntry("*")).toBeNull();
    expect(parseBrowserHosts("a.com\nb.com, a.com  bad_host")).toEqual(["a.com", "b.com"]);
  });

  it("maps a project to its partition and back", () => {
    expect(projectIdFromPartition(browserPartitionFor("abc_DEF-1"))).toBe("abc_DEF-1");
    expect(projectIdFromPartition("persist:other")).toBeNull();
    expect(projectIdFromPartition("persist:project-../x")).toBeNull();
    expect(projectIdFromPartition(undefined)).toBeNull();
  });
});
