import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ net: { fetch: vi.fn() } }));
vi.mock("../agents/spawn-env", () => ({ _getFullPath: () => "" }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
const { CLI_CATALOG, COMMAND_ALIASES, cliSetupFor } = await import("../agents/cli-catalog");

describe("cliSetupFor", () => {
  it("picks the command for the OS", () => {
    expect(cliSetupFor("claude-code", "darwin")?.install).toContain("install.sh");
    expect(cliSetupFor("claude-code", "linux")?.install).toContain("install.sh");
    expect(cliSetupFor("claude-code", "win32")?.install).toContain("install.ps1");
    expect(cliSetupFor("kiro", "linux")?.install).toContain("kirocli-x86_64-linux.zip");
    expect(cliSetupFor("crush", "win32")?.update).toBe("winget upgrade charmbracelet.crush");
  });

  it("no update command: re-running the installer updates it", () => {
    expect(cliSetupFor("codex", "darwin")?.update).toBe(cliSetupFor("codex", "darwin")?.install);
  });

  it("an OS with no native install has no command, only its guide", () => {
    const amp = cliSetupFor("amp", "win32");
    expect(amp?.install).toBeNull();
    expect(amp?.docs).toBe("https://ampcode.com/docs/cli");
  });

  it("every CLI has an install for macOS and Linux and a docs URL", () => {
    for (const id of Object.keys(CLI_CATALOG)) {
      for (const os of ["darwin", "linux"] as const)
        expect(cliSetupFor(id, os)?.install).toBeTruthy();
      expect(cliSetupFor(id)?.docs).toMatch(/^https:\/\//);
    }
  });

  it("binary aliases are keyed by the provider's command (which equals its id there)", async () => {
    const { BUILTIN_PROVIDERS } = await import("../agents/registry");
    for (const id of Object.keys(COMMAND_ALIASES)) {
      expect(BUILTIN_PROVIDERS.find((p) => p.id === id)?.command).toBe(id);
    }
  });
});
