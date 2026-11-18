import { describe, expect, it } from "vitest";
import { renameEffect } from "./names";

describe("renameEffect", () => {
  it("moves the session name to a name newly given inside the CLI", () => {
    expect(renameEffect({ alias: "basalt", cliName: null }, "taskyserver")).toEqual({
      cliName: "taskyserver",
      alias: "taskyserver",
    });
  });

  it("leaves a name set in Exegol after the rename was read", () => {
    expect(renameEffect({ alias: "mine", cliName: "taskyserver" }, "taskyserver")).toBeNull();
  });

  it("only records a name the session already carries", () => {
    expect(renameEffect({ alias: "Tasky", cliName: null }, "tasky")).toEqual({
      cliName: "tasky",
      alias: null,
    });
    expect(renameEffect({ alias: "a", cliName: null }, null)).toBeNull();
  });
});
