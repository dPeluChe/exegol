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
    const out = applyLaunchModel(base, "factory-droid", "claude-opus-4-7", "a1", dir);
    const file = join(dir, "a1.json");
    expect(out.args).toEqual(["--yolo", "--settings", file]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ model: "claude-opus-4-7" });
  });

  it("no model, no way for that CLI, or an id that is not one: untouched", () => {
    expect(applyLaunchModel(base, "claude-code", undefined, "a1")).toBe(base);
    expect(applyLaunchModel(base, "crush", "x", "a1")).toBe(base);
    expect(applyLaunchModel(base, "claude-code", "opus; rm -rf ~", "a1")).toBe(base);
  });
});
