import { describe, expect, it } from "vitest";
import { otherCliName, renameEffect } from "./names";

const renamed = (name: string | null) => ({ name, renamed: true });

describe("renameEffect", () => {
  it("moves the session name to a name newly given inside the CLI", () => {
    expect(renameEffect({ alias: "basalt", cliName: null }, renamed("taskyserver"))).toEqual({
      cliName: "taskyserver",
      alias: "taskyserver",
    });
  });

  it("leaves a name set in Exegol after the rename was read", () => {
    expect(
      renameEffect({ alias: "mine", cliName: "taskyserver" }, renamed("taskyserver")),
    ).toBeNull();
  });

  it("only records a name the session already carries", () => {
    expect(renameEffect({ alias: "Tasky", cliName: null }, renamed("tasky"))).toEqual({
      cliName: "tasky",
      alias: null,
    });
    expect(renameEffect({ alias: "a", cliName: null }, renamed(null))).toBeNull();
  });

  it("keeps a title the CLI wrote by itself beside the name, never over it", () => {
    const effect = renameEffect(
      { alias: "basalt", cliName: null },
      { name: "Fix the login test", renamed: false },
    );
    expect(effect).toEqual({ cliName: "Fix the login test", alias: null });
  });
});

describe("otherCliName", () => {
  it("is the CLI's name only when it is not the session's own", () => {
    expect(otherCliName({ alias: "basalt", cliName: "Fix the login test" })).toBe(
      "Fix the login test",
    );
    expect(otherCliName({ alias: "tasky", cliName: "tasky" })).toBeNull();
  });
});
