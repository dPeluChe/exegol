import { describe, expect, it } from "vitest";
import {
  classifyInstall,
  selfUpdatedVersion,
  uninstallCommandFor,
  updateCommandFor,
} from "./cli-install-method";

const HOME = "/Users/me";

describe("classifyInstall", () => {
  // The 2026-10-09 incident: three codex copies, PATH order decided which ran
  it.each([
    [
      "codex",
      "/Users/me/.local/bin/codex",
      "/Users/me/.codex/packages/standalone/releases/0.162.1-aarch64-apple-darwin/bin/codex",
      { method: "standalone", pkg: null },
    ],
    [
      "codex",
      "/opt/homebrew/bin/codex",
      "/opt/homebrew/Caskroom/codex/0.161.0/codex-aarch64-apple-darwin",
      { method: "brew-cask", pkg: "codex" },
    ],
    [
      "codex",
      "/opt/homebrew/bin/codex",
      "/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js",
      { method: "npm", pkg: "@openai/codex" },
    ],
    [
      "crush",
      "/opt/homebrew/bin/crush",
      "/opt/homebrew/Cellar/crush/0.41.0/bin/crush",
      { method: "brew", pkg: "crush" },
    ],
    // A brew formula that bundles node_modules is still brew
    [
      "gemini",
      "/usr/local/bin/gemini",
      "/usr/local/Cellar/gemini-cli/0.9.0/libexec/lib/node_modules/@google/gemini-cli/dist/index.js",
      { method: "brew", pkg: "gemini-cli" },
    ],
    [
      "opencode",
      "/opt/homebrew/bin/opencode",
      "/opt/homebrew/lib/node_modules/opencode-ai/bin/opencode",
      { method: "npm", pkg: "opencode-ai" },
    ],
    [
      "opencode",
      "/Users/me/.opencode/bin/opencode",
      "/Users/me/.opencode/bin/opencode",
      { method: "standalone", pkg: null },
    ],
    [
      "claude-code",
      "/Users/me/.local/bin/claude",
      "/Users/me/.local/share/claude/versions/2.1.296",
      { method: "standalone", pkg: null },
    ],
    [
      "claude-code",
      "/Users/me/.nvm/versions/node/v22.1.0/bin/claude",
      "/Users/me/.nvm/versions/node/v22.1.0/lib/node_modules/@anthropic-ai/claude-code/cli.js",
      { method: "npm", pkg: "@anthropic-ai/claude-code" },
    ],
    [
      "codex",
      "/Users/me/.bun/bin/codex",
      "/Users/me/.bun/install/global/node_modules/@openai/codex/bin/codex.js",
      { method: "bun", pkg: "@openai/codex" },
    ],
    [
      "codex",
      "/Users/me/Library/pnpm/codex",
      "/Users/me/Library/pnpm/global/5/.pnpm/@openai+codex@0.1.0/node_modules/@openai/codex/bin/codex.js",
      { method: "pnpm", pkg: "@openai/codex" },
    ],
    [
      "aider",
      "/Users/me/.local/bin/aider",
      "/Users/me/.local/share/uv/tools/aider-chat/bin/aider",
      { method: "uv", pkg: "aider-chat" },
    ],
    [
      "aider",
      "/Users/me/.local/bin/aider",
      "/Users/me/.local/pipx/venvs/aider-chat/bin/aider",
      { method: "pipx", pkg: "aider-chat" },
    ],
    [
      "codex",
      "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd",
      "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd",
      { method: "npm", pkg: "@openai/codex" },
    ],
    ["devin", "/usr/local/bin/devin", "/usr/local/bin/devin", { method: "unknown", pkg: null }],
  ])("%s at %s", (cliType, path, real, expected) => {
    expect(classifyInstall(cliType, path, real, HOME)).toEqual(expected);
  });
});

describe("updateCommandFor", () => {
  const mac = "darwin" as const;
  it("updates the copy that runs, by how it was installed", () => {
    expect(updateCommandFor("codex", { method: "brew-cask", pkg: "codex" }, mac).command).toBe(
      "brew upgrade --cask codex",
    );
    expect(updateCommandFor("crush", { method: "brew", pkg: "crush" }, mac).command).toBe(
      "brew upgrade crush",
    );
    expect(updateCommandFor("codex", { method: "npm", pkg: "@openai/codex" }, mac).command).toBe(
      "npm install -g @openai/codex@latest",
    );
    expect(updateCommandFor("aider", { method: "uv", pkg: "aider-chat" }, mac).command).toBe(
      "uv tool upgrade aider-chat",
    );
  });

  it("a standalone copy uses the vendor's updater or installer", () => {
    expect(updateCommandFor("codex", { method: "standalone", pkg: null }, mac)).toEqual({
      command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
      note: null,
    });
    expect(updateCommandFor("claude-code", { method: "standalone", pkg: null }, mac).command).toBe(
      "claude update",
    );
  });

  it("an unknown copy gets the catalog default with a note", () => {
    const r = updateCommandFor("codex", { method: "unknown", pkg: null }, mac);
    expect(r.command).toContain("install.sh");
    expect(r.note).toMatch(/not recognized/);
  });
});

describe("uninstallCommandFor", () => {
  it("names the package manager's remove, or the file", () => {
    expect(uninstallCommandFor({ method: "npm", pkg: "@openai/codex" }, "/x")).toBe(
      "npm uninstall -g @openai/codex",
    );
    expect(uninstallCommandFor({ method: "brew-cask", pkg: "codex" }, "/x")).toBe(
      "brew uninstall --cask codex",
    );
    expect(
      uninstallCommandFor({ method: "standalone", pkg: null }, "/Users/me/.local/bin/codex"),
    ).toBe("rm /Users/me/.local/bin/codex");
    expect(uninstallCommandFor({ method: "unknown", pkg: null }, "/Users/a b/bin/x")).toBe(
      "rm '/Users/a b/bin/x'",
    );
  });
});

describe("selfUpdatedVersion", () => {
  it("is the new version when it changed since spawn", () => {
    expect(selfUpdatedVersion("0.161.0", "0.162.1")).toBe("0.162.1");
  });
  it("is null when unchanged or unknown", () => {
    expect(selfUpdatedVersion("0.162.1", "0.162.1")).toBeNull();
    expect(selfUpdatedVersion(null, "0.162.1")).toBeNull();
    expect(selfUpdatedVersion("0.162.1", null)).toBeNull();
  });
});
