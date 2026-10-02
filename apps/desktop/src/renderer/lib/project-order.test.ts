import type { Project } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import type { ShortcutDigit } from "../stores/shortcuts";
import { autoOrderProjects } from "./project-order";

const p = (id: string, name: string) => ({ id, name }) as Project;

describe("autoOrderProjects", () => {
  it("Cmd+n in key order, then the live ones, then the rest, each alphabetical", () => {
    const projects = [
      p("z", "zeta"),
      p("t", "Tasky"),
      p("e", "exegol"),
      p("o", "Orbital"),
      p("a", "argos"),
      p("y", "yutu"),
    ];
    const shortcuts = new Map<string, ShortcutDigit>([
      ["y", "0"],
      ["t", "3"],
      ["e", "2"],
    ]);
    const order = autoOrderProjects(projects, shortcuts, new Set(["o", "z"])).map((x) => x.id);
    expect(order).toEqual(["e", "t", "y", "o", "z", "a"]);
  });
});
