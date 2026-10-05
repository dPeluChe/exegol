import { describe, expect, it } from "vitest";
import { childEnv } from "./child-env";

describe("childEnv", () => {
  it("drops another session's markers and Exegol's own, keeps user config", () => {
    const env = childEnv({
      CLAUDECODE: "1",
      CLAUDE_CODE_CHILD_SESSION: "1",
      CODEX_THREAD_ID: "t",
      EXEGOL_AGENT_ID: "a",
      CLAUDE_CONFIG_DIR: "/c",
      CLAUDE_CODE_USE_BEDROCK: "1",
      PATH: "/bin",
    });
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: "/c", CLAUDE_CODE_USE_BEDROCK: "1", PATH: "/bin" });
  });
});
