import { describe, expect, it, vi } from "vitest";

vi.mock("./registry", () => ({ getProviderRegistry: () => ({ get: () => undefined }) }));
vi.mock("./spawn-env", () => ({ _getFullPath: () => "", resolveCommand: (c: string) => c }));
const { _parsers } = await import("./model-lists");
const parse = (cli: string, out: string) => _parsers.LIST_COMMANDS[cli]?.parse(out);

describe("model list parsers (output shapes from the CLIs, 2026-09-30)", () => {
  it("codex: JSON slugs", () => {
    expect(parse("codex", '{"models":[{"slug":"gpt-6-astra"},{"slug":"gpt-6-mini"}]}')).toEqual([
      "gpt-6-astra",
      "gpt-6-mini",
    ]);
  });
  it("agy: id<TAB>name rows after a status line", () => {
    expect(
      parse(
        "agy",
        "Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n",
      ),
    ).toEqual(["gemini-3.8-flash-high"]);
  });
  it("devin: indented ids, not family headers or aliases", () => {
    const out =
      "Available models (53 families)\n\nSWE-2 (swe-2)\n  aliases: swe\n  swe-2-high                  SWE-2 High  [262K context, Free]\n";
    expect(parse("devin", out)).toEqual(["swe-2-high"]);
  });
  it("opencode / kilo: one provider/model per line", () => {
    expect(parse("opencode", "opencode/claude-opus-5-5\nopencode/big-pickle\n")).toEqual([
      "opencode/claude-opus-5-5",
      "opencode/big-pickle",
    ]);
  });
});
