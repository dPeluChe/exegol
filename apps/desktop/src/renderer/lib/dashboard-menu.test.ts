import { describe, expect, it } from "vitest";
import { fleetCardMenu, goneCardMenu, watchCardMenu } from "./dashboard-menu";

const card = {
  live: true,
  expanded: true,
  hasSelection: false,
  sizing: false,
  canFloat: true,
};

describe("watchCardMenu", () => {
  it("live card without selection: go, view controls, float, unpin", () => {
    expect(watchCardMenu(card)).toEqual([
      ["go-to"],
      ["collapse", "fit-to-card", "font-smaller", "font-larger", "refresh", "float"],
      ["unpin"],
    ]);
  });

  it("a selection adds Copy and Send selection to", () => {
    expect(watchCardMenu({ ...card, hasSelection: true })[1]).toEqual(["copy", "send-selection"]);
  });

  it("a sizing card offers to stop sizing", () => {
    expect(watchCardMenu({ ...card, sizing: true })[1]).toContain("stop-fit");
  });

  it("no pane, or already floating: no float", () => {
    expect(watchCardMenu({ ...card, canFloat: false }).flat()).not.toContain("float");
  });

  it("collapsed strip: expand, no mirror items", () => {
    expect(watchCardMenu({ ...card, expanded: false, hasSelection: true })).toEqual([
      ["go-to"],
      ["expand", "float"],
      ["unpin"],
    ]);
  });

  it("ended session: resume, no float or sizing", () => {
    expect(watchCardMenu({ ...card, live: false })).toEqual([
      ["go-to", "resume"],
      ["collapse"],
      ["unpin"],
    ]);
  });
});

describe("goneCardMenu", () => {
  it("known session: resume, open project, unpin", () => {
    expect(goneCardMenu(true)).toEqual([["resume", "open-project"], ["unpin"]]);
  });

  it("unknown session: only unpin", () => {
    expect(goneCardMenu(false)).toEqual([["unpin"]]);
  });
});

describe("fleetCardMenu", () => {
  const agent = { live: true, shell: false, watched: false, muted: false };

  it("live agent: watch, mute, suspend", () => {
    expect(fleetCardMenu(agent)).toEqual([
      ["go-to", "watch"],
      ["mute", "suspend"],
    ]);
  });

  it("watched and muted", () => {
    expect(fleetCardMenu({ ...agent, watched: true, muted: true })).toEqual([
      ["go-to", "unwatch"],
      ["unmute", "suspend"],
    ]);
  });

  it("live shell: no mute or suspend", () => {
    expect(fleetCardMenu({ ...agent, shell: true })).toEqual([["go-to", "watch"]]);
  });

  it("ended: resume and archive, pin only to take it off", () => {
    expect(fleetCardMenu({ ...agent, live: false })).toEqual([["go-to"], ["resume", "archive"]]);
    expect(fleetCardMenu({ ...agent, live: false, watched: true })[0]).toEqual([
      "go-to",
      "unwatch",
    ]);
  });
});
