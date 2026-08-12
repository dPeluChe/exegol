import type { Agent, AgentCreate } from "@exegol/shared";
import Database from "libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations";
import { createAgent } from "../db/queries";
import { buildPtyInvocation } from "./agent-spawn-flow";
import type { AgentProviderRegistry } from "./registry";

const mocks = vi.hoisted(() => ({
  hooksPath: "/tmp/exegol-hooks/agent.json" as string | null,
  lifecycle: null as { beforeAgent?: string } | null,
  writeAgentMcpConfigFor: vi.fn(),
  writePerAgentMcpConfig: vi.fn(() => "/tmp/exegol-mcp/agent.json"),
  ensureExegolMcpServerStarted: vi.fn(),
  buildClaudeCodeHooksFile: vi.fn((_agentId: string) => mocks.hooksPath),
}));

vi.mock("./spawn-env", () => ({
  coreRust: null,
  slugifyBranchName: (s: string) => s,
  _getFullPath: () => "/usr/local/bin:/usr/bin",
  buildApiKeyEnv: () => ({ ANTHROPIC_API_KEY: "sk-test" }),
  buildClaudeCodeHooksFile: mocks.buildClaudeCodeHooksFile,
}));
vi.mock("./spawn-context", () => ({
  buildSpawnContext: () => ({ contextPrefix: "" }),
  buildShellCommand: (
    _registry: unknown,
    _agent: unknown,
    cliConfig: { command: string; args: string[] },
  ) => [cliConfig.command, ...cliConfig.args].join(" ").trim(),
}));
vi.mock("./worktrees", () => ({
  createManagedWorktree: vi.fn(),
  removeManagedWorktree: vi.fn(),
  getWorktreeName: (b: string) => b,
}));
vi.mock("../hooks/project-hooks", () => ({ runSetupHook: vi.fn(async () => {}) }));
vi.mock("../lifecycle/loader", () => ({ loadLifecycleConfig: () => mocks.lifecycle }));
vi.mock("../mcp/exegol-server", () => ({
  ensureExegolMcpServerStarted: mocks.ensureExegolMcpServerStarted,
  registerAgentMcpToken: () => "test-mcp-token",
}));
vi.mock("../mcp/exegol-mcp-config", () => ({
  resolveMcpShimPath: () => "/shim/exegol-mcp-shim.js",
  writeAgentMcpConfigFor: mocks.writeAgentMcpConfigFor,
  writePerAgentMcpConfig: mocks.writePerAgentMcpConfig,
}));
vi.mock("../terminal/shell-wrappers", () => ({
  shellSupportsMarker: () => false,
  getShellIntegrationZdotdir: () => "/integration/zdotdir",
  getShellIntegrationBashRcfile: () => "/integration/bashrc",
  getFishInitCommand: () => "init-fish",
}));

const PROVIDERS: Record<string, { capabilities: Record<string, unknown> }> = {
  "claude-code": { capabilities: { supportsPromptArg: true, resumeFlag: "--continue" } },
  gemini: { capabilities: { supportsPromptArg: false, resumeFlag: "" } },
};
const registry = {
  get: (cliType: string) => PROVIDERS[cliType],
} as unknown as AgentProviderRegistry;

const cliConfig = { command: "claude", args: [] as string[], env: { CLI_EXTRA: "1" } };

describe("buildPtyInvocation", () => {
  let db: Database.Database;
  const originalShell = process.env.SHELL;

  function makeAgent(cliType: string, config: Partial<AgentCreate> = {}): [Agent, AgentCreate] {
    const create: AgentCreate = {
      projectId: "p1",
      cliType: cliType as AgentCreate["cliType"],
      taskDescription: "do the task",
      ...config,
    };
    return [createAgent(db, create), create];
  }

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'proj', '/tmp/p1')").run();
    process.env.SHELL = "/bin/zsh";
    mocks.hooksPath = "/tmp/exegol-hooks/agent.json";
    mocks.lifecycle = null;
    mocks.writeAgentMcpConfigFor.mockClear();
    mocks.writePerAgentMcpConfig.mockClear();
    mocks.buildClaudeCodeHooksFile.mockClear();
  });

  afterEach(() => {
    process.env.SHELL = originalShell;
  });

  it("spawns a plain shell as an interactive login shell without agent wiring", () => {
    const [agent, config] = makeAgent("shell");
    const inv = buildPtyInvocation(db, agent, config, "/tmp/p1", registry, cliConfig, "/tmp/p1");

    expect(inv.isPlainShell).toBe(true);
    expect(inv.shell).toBe("/bin/zsh");
    expect(inv.args).toEqual(["-il"]);
    expect(inv.stdinCommand).toBeNull();
    expect(inv.env.EXEGOL_AGENT_ID).toBe(agent.id);
    expect(inv.env.DISABLE_AUTO_UPDATE).toBe("true");
    expect(inv.env.DISABLE_UPDATE_PROMPT).toBe("true");
    expect(inv.env.EXEGOL_MCP_TOKEN).toBeUndefined();
    expect(mocks.writeAgentMcpConfigFor).not.toHaveBeenCalled();
  });

  it("spawns a prompt-arg CLI via -ic with full env wiring", () => {
    const [agent, config] = makeAgent("claude-code", { accessMode: "write" });
    const inv = buildPtyInvocation(db, agent, config, "/tmp/cwd", registry, cliConfig, "/tmp/p1");

    expect(inv.isPlainShell).toBe(false);
    expect(inv.args[0]).toBe("-ic");
    expect(inv.stdinCommand).toBeNull();
    expect(inv.env.DISABLE_AUTO_UPDATE).toBe("true");
    expect(inv.env.ANTHROPIC_API_KEY).toBe("sk-test");
    expect(inv.env.CLI_EXTRA).toBe("1");
    expect(inv.env.PATH).toBe("/usr/local/bin:/usr/bin");
    expect(inv.env.EXEGOL_AGENT_ID).toBe(agent.id);
    expect(inv.env.EXEGOL_ACCESS_MODE).toBe("write");
    expect(inv.env.EXEGOL_MCP_TOKEN).toBe("test-mcp-token");
    // claude-code gets a PRIVATE per-agent config (outside the repo) passed
    // via --mcp-config, so siblings in one cwd keep distinct identities.
    expect(mocks.writePerAgentMcpConfig).toHaveBeenCalledWith(
      expect.any(String),
      "/shim/exegol-mcp-shim.js",
      "test-mcp-token",
      "write",
    );
    expect(mocks.writeAgentMcpConfigFor).not.toHaveBeenCalled();
    expect(inv.args.join(" ")).toContain("--mcp-config /tmp/exegol-mcp/agent.json");
  });

  it("defaults EXEGOL_ACCESS_MODE to write and honors an explicit read mode", () => {
    const [agentDefault, configDefault] = makeAgent("claude-code");
    const invDefault = buildPtyInvocation(
      db,
      agentDefault,
      configDefault,
      "/tmp/cwd",
      registry,
      cliConfig,
      "/tmp/p1",
    );
    expect(invDefault.env.EXEGOL_ACCESS_MODE).toBe("write");

    const [agentRead, configRead] = makeAgent("claude-code", { accessMode: "read" });
    const invRead = buildPtyInvocation(
      db,
      agentRead,
      configRead,
      "/tmp/cwd",
      registry,
      cliConfig,
      "/tmp/p1",
    );
    expect(invRead.env.EXEGOL_ACCESS_MODE).toBe("read");
  });

  it("routes interactive CLIs through stdin injection instead of -ic", () => {
    const [agent, config] = makeAgent("gemini");
    const inv = buildPtyInvocation(
      db,
      agent,
      config,
      "/tmp/cwd",
      registry,
      { command: "gemini", args: [], env: {} },
      "/tmp/p1",
    );

    expect(inv.args).toEqual(["-i"]);
    expect(inv.stdinCommand).toContain("gemini");
  });

  it("appends the claude-code hooks file via --settings", () => {
    const [agent, config] = makeAgent("claude-code");
    const inv = buildPtyInvocation(db, agent, config, "/tmp/cwd", registry, cliConfig, "/tmp/p1");

    expect(mocks.buildClaudeCodeHooksFile).toHaveBeenCalledWith(agent.id);
    expect(inv.args[1]).toContain("--settings /tmp/exegol-hooks/agent.json");
  });

  it("does not double-append --settings when the command already carries one", () => {
    const [agent, config] = makeAgent("claude-code");
    const inv = buildPtyInvocation(
      db,
      agent,
      config,
      "/tmp/cwd",
      registry,
      { command: "claude --settings /already/there.json", args: [], env: {} },
      "/tmp/p1",
    );

    expect(mocks.buildClaudeCodeHooksFile).not.toHaveBeenCalled();
    expect(inv.args[1]?.match(/--settings/g)).toHaveLength(1);
  });

  it("skips hooks for non-claude providers", () => {
    const [agent, config] = makeAgent("gemini");
    buildPtyInvocation(
      db,
      agent,
      config,
      "/tmp/cwd",
      registry,
      { command: "gemini", args: [], env: {} },
      "/tmp/p1",
    );
    expect(mocks.buildClaudeCodeHooksFile).not.toHaveBeenCalled();
  });

  it("prefers a stored resume_command when resuming", () => {
    const [agent, config] = makeAgent("claude-code", { resumeSession: true });
    db.prepare("UPDATE agents SET resume_command = 'claude --resume stored-one' WHERE id = ?").run(
      agent.id,
    );
    const inv = buildPtyInvocation(db, agent, config, "/tmp/cwd", registry, cliConfig, "/tmp/p1");
    expect(inv.args[1]).toContain("claude --resume stored-one");
  });

  it("falls back to --resume <claude_session_id> when no resume_command is stored", () => {
    const [agent, config] = makeAgent("claude-code", { resumeSession: true });
    db.prepare("UPDATE agents SET claude_session_id = 'sess-42' WHERE id = ?").run(agent.id);
    const inv = buildPtyInvocation(db, agent, config, "/tmp/cwd", registry, cliConfig, "/tmp/p1");
    expect(inv.args[1]).toContain("claude --resume sess-42");
  });

  it("falls back to the provider resumeFlag when nothing is stored", () => {
    const [agent, config] = makeAgent("claude-code", { resumeSession: true });
    const inv = buildPtyInvocation(db, agent, config, "/tmp/cwd", registry, cliConfig, "/tmp/p1");
    expect(inv.args[1]).toContain("claude --continue");
  });

  it("prepends the lifecycle beforeAgent hook to the command", () => {
    mocks.lifecycle = { beforeAgent: "npm install" };
    const [agent, config] = makeAgent("claude-code");
    const inv = buildPtyInvocation(db, agent, config, "/tmp/cwd", registry, cliConfig, "/tmp/p1");
    expect(inv.args[1]?.startsWith("npm install && claude")).toBe(true);
  });

  it("refuses destructive commands at the spawn boundary", () => {
    const [agent, config] = makeAgent("claude-code");
    expect(() =>
      buildPtyInvocation(
        db,
        agent,
        config,
        "/tmp/cwd",
        registry,
        { command: "rm -rf /", args: [], env: {} },
        "/tmp/p1",
      ),
    ).toThrow(/safety guard/);
  });
});
