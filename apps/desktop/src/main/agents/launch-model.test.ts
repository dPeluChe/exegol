import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyLaunchModel } from "./launch-model";

const base = { args: ["--yolo"], env: { A: "1" } };

describe("applyLaunchModel", () => {
  it("a flag CLI gets the flag after its own args", () => {
    expect(applyLaunchModel(base, "claude-code", "opus", "a1").args).toEqual([
      "--yolo",
      "--model",
      "opus",
    ]);
    expect(applyLaunchModel(base, "amp", "rush", "a1").args).toEqual(["--yolo", "-m", "rush"]);
  });

  it("goose takes it from GOOSE_MODEL", () => {
    const out = applyLaunchModel(base, "goose", "claude-sonnet-4-5", "a1");
    expect(out.env).toEqual({ A: "1", GOOSE_MODEL: "claude-sonnet-4-5" });
    expect(out.args).toEqual(["--yolo"]);
  });

  it("droid gets a per-process settings file with the model", () => {
    const dir = mkdtempSync(join(tmpdir(), "exegol-model-"));
    const out = applyLaunchModel(
      base,
      "factory-droid",
      "claude-opus-4-7",
      "a1",
      { spec: "gpt-5" },
      dir,
    );
    const file = join(dir, "a1.json");
    expect(out.args).toEqual(["--yolo", "--settings", file]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      sessionDefaultSettings: { model: "claude-opus-4-7", specModeModel: "gpt-5" },
    });
  });

  it("claude takes the advisor by flag and the subagent model by env", () => {
    const out = applyLaunchModel(base, "claude-code", "sonnet", "a1", {
      advisor: "opus",
      subagents: "haiku",
    });
    expect(out.args).toEqual(["--yolo", "--model", "sonnet", "--advisor", "opus"]);
    expect(out.env).toEqual({ A: "1", CLAUDE_CODE_SUBAGENT_MODEL: "haiku" });
  });

  it("an advisor Claude Code would exit on is left out", () => {
    expect(applyLaunchModel(base, "claude-code", undefined, "a1", { advisor: "fable" })).toBe(base);
    expect(applyLaunchModel(base, "claude-code", "fable", "a1", { advisor: "opus" }).args).toEqual([
      "--yolo",
      "--model",
      "fable",
    ]);
  });

  it("codex roles are -c overrides, aider's editor turns on architect mode once", () => {
    const codex = applyLaunchModel(base, "codex", undefined, "a1", {
      subagents: "gpt-5.5-mini",
      review: "gpt-5.5",
    });
    expect(codex.args).toEqual([
      "--yolo",
      "-c",
      "agents.default_subagent_model=gpt-5.5-mini",
      "-c",
      "review_model=gpt-5.5",
    ]);
    const aider = applyLaunchModel({ args: ["--architect"], env: {} }, "aider", "o3", "a1", {
      editor: "sonnet",
    });
    expect(aider.args).toEqual(["--architect", "--model", "o3", "--editor-model", "sonnet"]);
  });

  it("opencode roles merge into one JSON config over the user's own", () => {
    const out = applyLaunchModel(
      { args: [], env: { OPENCODE_CONFIG_CONTENT: '{"theme":"x","agent":{"plan":{"t":1}}}' } },
      "opencode",
      undefined,
      "a1",
      { plan: "anthropic/claude-opus-5", small: "anthropic/claude-haiku-4-5" },
    );
    expect(JSON.parse(out.env.OPENCODE_CONFIG_CONTENT ?? "")).toEqual({
      theme: "x",
      agent: { plan: { t: 1, model: "anthropic/claude-opus-5" } },
      small_model: "anthropic/claude-haiku-4-5",
    });
  });

  it("a role the CLI does not have is ignored", () => {
    expect(applyLaunchModel(base, "gemini", undefined, "a1", { advisor: "pro" })).toBe(base);
  });

  it("no model, no way for that CLI, or an id that is not one: untouched", () => {
    expect(applyLaunchModel(base, "claude-code", undefined, "a1")).toBe(base);
    expect(applyLaunchModel(base, "crush", "x", "a1")).toBe(base);
    expect(applyLaunchModel(base, "claude-code", "opus; rm -rf ~", "a1")).toBe(base);
  });
});
