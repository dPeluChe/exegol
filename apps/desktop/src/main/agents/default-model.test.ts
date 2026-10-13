import { describe, expect, it } from "vitest";
import { claudeDefaultModel, codexDefaultModel, geminiDefaultModel } from "./default-model";

describe("claudeDefaultModel", () => {
  it("reads settings.json model", () => {
    expect(claudeDefaultModel('{"model":"opus","hooks":{}}', {})).toEqual({
      model: "opus",
      source: "~/.claude/settings.json",
    });
  });
  it("ANTHROPIC_MODEL wins, like in Claude Code", () => {
    expect(claudeDefaultModel('{"model":"opus"}', { ANTHROPIC_MODEL: "sonnet" })).toEqual({
      model: "sonnet",
      source: "ANTHROPIC_MODEL",
    });
  });
  it("unknown: no file, no model, broken JSON or not a model id", () => {
    expect(claudeDefaultModel(null, {})).toBeNull();
    expect(claudeDefaultModel('{"theme":"dark"}', {})).toBeNull();
    expect(claudeDefaultModel("{oops", {})).toBeNull();
    expect(claudeDefaultModel('{"model":"rm -rf /"}', {})).toBeNull();
  });
});

describe("codexDefaultModel", () => {
  it("reads the top-level model, not a profile's", () => {
    const toml =
      'approval_policy = "never"\nmodel = "gpt-5-codex"\n\n[profiles.fast]\nmodel = "o4"';
    expect(codexDefaultModel(toml)).toEqual({
      model: "gpt-5-codex",
      source: "~/.codex/config.toml",
    });
    expect(codexDefaultModel('[profiles.fast]\nmodel = "o4"')).toBeNull();
    expect(codexDefaultModel(null)).toBeNull();
  });
  it("model_provider is not model", () => {
    expect(codexDefaultModel('model_provider = "openai"')).toBeNull();
  });
});

describe("geminiDefaultModel", () => {
  it("reads model.name or a plain model", () => {
    expect(geminiDefaultModel('{"model":{"name":"gemini-2.5-pro"}}')?.model).toBe("gemini-2.5-pro");
    expect(geminiDefaultModel('{"model":"gemini-2.5-flash"}')?.model).toBe("gemini-2.5-flash");
    expect(geminiDefaultModel("{}")).toBeNull();
  });
});
