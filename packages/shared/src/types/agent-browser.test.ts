import { describe, expect, it } from "vitest";
import {
  browserPartitionFor,
  checkAgentUrl,
  isHostAllowed,
  isLocalHost,
  normalizeHostEntry,
  parseBrowserHosts,
  projectIdFromPartition,
} from "./agent-browser";

describe("agent browser URL policy", () => {
  it("allows local hosts by default", () => {
    for (const url of [
      "http://localhost:3000/a",
      "http://127.0.0.1:5173",
      "http://[::1]:8080/",
      "https://app.localhost",
      "http://my-mac.local:3000",
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
