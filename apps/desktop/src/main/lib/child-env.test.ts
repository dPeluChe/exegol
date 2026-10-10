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
      LANG: "es_MX.UTF-8",
    });
    expect(env).toEqual({
      CLAUDE_CONFIG_DIR: "/c",
      CLAUDE_CODE_USE_BEDROCK: "1",
      PATH: "/bin",
      LANG: "es_MX.UTF-8",
    });
  });

  it("gives a UTF-8 encoding when the app started with no locale (opened from Finder)", () => {
    expect(childEnv({ PATH: "/bin" }, "darwin").LC_CTYPE).toBe("UTF-8");
    expect(childEnv({ PATH: "/bin" }, "linux").LC_CTYPE).toBe("C.UTF-8");
    expect(childEnv({ PATH: "/bin" }, "win32").LC_CTYPE).toBeUndefined();
  });

  it("never overrides a locale the user set", () => {
    expect(childEnv({ LANG: "es_MX.UTF-8" }, "darwin").LC_CTYPE).toBeUndefined();
    expect(childEnv({ LC_ALL: "en_US.UTF-8" }, "darwin").LC_CTYPE).toBeUndefined();
    expect(childEnv({ LC_CTYPE: "ja_JP.UTF-8" }, "darwin").LC_CTYPE).toBe("ja_JP.UTF-8");
  });
});
