import { describe, expect, it } from "vitest";
import { parseCustomActions, parseJustRecipes, parseMakeTargets } from "./scripts";

// These parsers decide what the launcher offers to RUN, so a false positive is
// a button that executes something meaningless — and a miss is a project whose
// only entry point is invisible.
describe("parseMakeTargets", () => {
  it("takes real targets and skips everything that only looks like one", () => {
    const make = [
      "CC := gcc",
      "SRC = main.c",
      ".PHONY: build test",
      "",
      "# a comment",
      "build:",
      "\tgo build ./...",
      "test: build",
      "\tgo test ./...",
      "%.o: %.c",
      "\t$(CC) -c $<",
      "\tindented: not-a-target",
    ].join("\n");

    expect(parseMakeTargets(make)).toEqual(["build", "test"]);
  });

  it("does not repeat a target declared twice", () => {
    expect(parseMakeTargets("build:\n\techo one\nbuild:\n\techo two")).toEqual(["build"]);
  });
});

describe("parseJustRecipes", () => {
  it("reads recipes with parameters and ignores assignments", () => {
    const just = [
      "set shell := ['bash', '-c']",
      "version := '1.0'",
      "# comment",
      "dev:",
      "  bun run dev",
      "deploy env='prod':",
      "  ./deploy.sh {{env}}",
    ].join("\n");

    expect(parseJustRecipes(just)).toEqual(["dev", "deploy"]);
  });
});

describe("parseCustomActions", () => {
  it("keeps the command verbatim, including colons and quotes", () => {
    const yaml = [
      "# project actions",
      "seed: bun run seed",
      'tunnel: "ssh -L 8080:localhost:80 box"',
      "",
    ].join("\n");

    expect(parseCustomActions(yaml)).toEqual([
      { name: "seed", command: "bun run seed" },
      { name: "tunnel", command: "ssh -L 8080:localhost:80 box" },
    ]);
  });

  it("ignores a line with no command", () => {
    expect(parseCustomActions("broken:\nalso-broken:   \n")).toEqual([]);
  });
});
