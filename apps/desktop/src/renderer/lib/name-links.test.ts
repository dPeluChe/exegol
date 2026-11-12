import { describe, expect, it } from "vitest";
import { type NameLink, nameSplitter, parseJump, projectHref, sessionHref } from "./name-links";

const splitNames = (text: string, links: NameLink[]) => nameSplitter(links)(text);

const amber = { name: "amber", href: sessionHref("a1", "p1") };
const blueprints = { name: "Blueprints", href: projectHref("p1") };

describe("session and project names as links", () => {
  it("cuts the text at whole names, same case, and leaves the rest", () => {
    expect(splitNames("amber (Blueprints) waits", [amber, blueprints])).toEqual([
      amber,
      " (",
      blueprints,
      ") waits",
    ]);
    expect(splitNames("Amber, chamber, amber-2, blueprints", [amber, blueprints])).toEqual([
      "Amber, chamber, amber-2, blueprints",
    ]);
  });

  it("skips very short names and keeps the first of a repeated one", () => {
    const short = { name: "ui", href: projectHref("p2") };
    const twin = { name: "amber", href: sessionHref("a9", "p9") };
    expect(splitNames("ui and amber", [short, amber, twin])).toEqual(["ui and ", amber]);
  });

  it("reads back what a link points to, and nothing else", () => {
    expect(parseJump(amber.href)).toEqual({ kind: "session", agentId: "a1", projectId: "p1" });
    expect(parseJump(blueprints.href)).toEqual({ kind: "project", projectId: "p1" });
    expect(parseJump("https://example.com")).toBeNull();
    expect(parseJump("exegol:session:a1")).toBeNull();
  });
});
