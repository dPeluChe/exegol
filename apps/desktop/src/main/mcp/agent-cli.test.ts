import { describe, expect, it } from "vitest";
import { parseAgentCli, toolsAnswer } from "./agent-cli";
import { launcherText } from "./agent-cli-install";

describe("parseAgentCli", () => {
  it("builds agent_send from words and flags in any order", () => {
    expect(parseAgentCli(["send", "lynx", "review", "is", "done"])).toEqual({
      kind: "call",
      tool: "agent_send",
      args: { target: "lynx", message: "review is done" },
    });
    expect(
      parseAgentCli(["send", "--reply-to", "m-1", "lynx", "ok", "--no-reply", "--id", "k-1"]),
    ).toMatchObject({
      args: {
        target: "lynx",
        message: "ok",
        in_reply_to: "m-1",
        expects_reply: false,
        message_id: "k-1",
      },
    });
    expect(parseAgentCli(["send", "lynx", "-"])).toMatchObject({ stdin: "message" });
  });

  it("reads status, any tool with JSON, and the tool list", () => {
    expect(parseAgentCli(["status", "m-1"])).toMatchObject({
      tool: "message_status",
      args: { message_id: "m-1" },
    });
    expect(parseAgentCli(["call", "inbox_get", '{"thread":"t-1"}'])).toMatchObject({
      tool: "inbox_get",
      args: { thread: "t-1" },
    });
    expect(parseAgentCli(["call", "agents_list"])).toMatchObject({ args: {} });
    expect(parseAgentCli(["call", "note_write", "-"])).toMatchObject({ stdin: "args" });
    expect(parseAgentCli(["tools", "agent_send"])).toEqual({ kind: "tools", name: "agent_send" });
  });

  it("answers with the usage for what it cannot run", () => {
    expect(parseAgentCli([])).toEqual({ kind: "usage", error: undefined });
    for (const argv of [
      ["send", "lynx"],
      ["send", "lynx", "hi", "--reply-to"],
      ["status"],
      ["call", "x", "[1]"],
      ["nope"],
    ]) {
      expect(parseAgentCli(argv)).toMatchObject({ kind: "usage", error: expect.any(String) });
    }
  });
});

describe("toolsAnswer", () => {
  const tools = [
    { name: "agent_send", inputSchema: { required: ["target", "message"] } },
    { name: "agents_list" },
  ];

  it("lists what each tool needs, or one tool whole", () => {
    expect(toolsAnswer(tools)).toEqual([
      { name: "agent_send", needs: ["target", "message"] },
      { name: "agents_list", needs: [] },
    ]);
    expect(toolsAnswer(tools, "agent_send")).toBe(tools[0]);
    expect(toolsAnswer(tools, "nope")).toEqual({ error: "no tool named nope" });
  });
});

describe("launcherText", () => {
  it("runs the bundled script as Node and passes the arguments on", () => {
    const sh = launcherText("/app/out/main/exegol-agent-bin.js", "darwin");
    expect(sh).toMatch(/^#!\/bin\/sh\nELECTRON_RUN_AS_NODE=1 .*exegol-agent-bin\.js" "\$@"\n$/);
    expect(launcherText("/app/x.js", "win32")).toContain("set ELECTRON_RUN_AS_NODE=1\r\n");
  });
});
