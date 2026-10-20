import { describe, expect, it } from "vitest";
import { ipcEndpoint, isNamedPipe } from "./ipc-endpoint";

describe("ipcEndpoint", () => {
  it("keeps the socket file in ~/.exegol off Windows", () => {
    expect(ipcEndpoint("pty-sidecar", "darwin", "/Users/me/.exegol")).toBe(
      "/Users/me/.exegol/pty-sidecar.sock",
    );
    expect(ipcEndpoint("mcp-server", "linux", "/home/me/.exegol")).toBe(
      "/home/me/.exegol/mcp-server.sock",
    );
  });

  it("names a per-user pipe on Windows", () => {
    const pipe = ipcEndpoint("pty-sidecar", "win32", "C:\\Users\\me\\.exegol", () => "Jo Ann");
    expect(pipe).toBe("\\\\.\\pipe\\exegol-Jo_Ann-pty-sidecar");
    expect(isNamedPipe(pipe)).toBe(true);
    expect(
      ipcEndpoint("mcp-server", "win32", "x", () => {
        throw new Error("no account");
      }),
    ).toBe("\\\\.\\pipe\\exegol-user-mcp-server");
  });

  it("tells a pipe from a socket file", () => {
    expect(isNamedPipe("/Users/me/.exegol/mcp-server.sock")).toBe(false);
  });
});
