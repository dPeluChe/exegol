import { describe, expect, it } from "vitest";
import {
  computeReactions,
  MAX_PER_KIND,
  MAX_WAKES,
  newWatchState,
  type PrSnapshot,
  parsePrSnapshot,
} from "./pr-watch-reactions";

const T0 = Date.parse("2026-10-01T00:00:00Z");

function snap(over: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    number: 7,
    url: "https://github.com/o/r/pull/7",
    state: "OPEN",
    headSha: "aaaaaaa1",
    conflicting: false,
    failingChecks: [],
    feedback: [],
    ...over,
  };
}

const fail = (name: string) => ({ name, link: `https://ci/${name}` });

describe("parsePrSnapshot", () => {
  it("reads failing checks, feedback and conflicts from gh JSON", () => {
    const view = JSON.stringify({
      number: 7,
      url: "https://github.com/o/r/pull/7",
      state: "OPEN",
      headRefOid: "abc1234def",
      mergeable: "CONFLICTING",
      mergeStateStatus: "DIRTY",
      statusCheckRollup: [
        { __typename: "CheckRun", name: "lint", conclusion: "FAILURE", detailsUrl: "https://ci/1" },
        { __typename: "CheckRun", name: "test", conclusion: "SUCCESS", detailsUrl: "https://ci/2" },
        { __typename: "CheckRun", name: "build", status: "IN_PROGRESS", conclusion: "" },
        { __typename: "StatusContext", context: "deploy", state: "ERROR", targetUrl: "https://d" },
      ],
      reviews: [
        { id: "R1", author: { login: "bob" }, state: "CHANGES_REQUESTED", body: "fix it" },
        { id: "R2", author: { login: "bob" }, state: "APPROVED", body: "ok" },
        { id: "R3", author: { login: "bob" }, state: "COMMENTED", body: "" },
      ],
      comments: [
        { id: "C1", author: { login: "amy" }, body: "nit", createdAt: "2026-10-02T00:00:00Z" },
      ],
    });
    const inline = JSON.stringify([
      {
        id: 9,
        user: { login: "amy" },
        body: "rename",
        path: "src/a.ts",
        line: 12,
        created_at: "2026-10-02T00:00:00Z",
      },
    ]);
    const pr = parsePrSnapshot(view, inline);
    expect(pr?.headSha).toBe("abc1234def");
    expect(pr?.conflicting).toBe(true);
    expect(pr?.failingChecks).toEqual([
      { name: "lint", link: "https://ci/1" },
      { name: "deploy", link: "https://d" },
    ]);
    expect(pr?.feedback.map((f) => [f.id, f.kind, f.location])).toEqual([
      ["review:R1", "changes_requested", undefined],
      ["comment:C1", "comment", undefined],
      ["inline:9", "inline", "src/a.ts:12"],
    ]);
  });

  it("returns null for output that is not a PR", () => {
    expect(parsePrSnapshot("no pull requests found", null)).toBeNull();
    expect(parsePrSnapshot(JSON.stringify({ number: 1 }), null)).toBeNull();
  });
});

describe("computeReactions", () => {
  it("dedupes identical content and reacts again when it changes", () => {
    const state = newWatchState(T0);
    const first = computeReactions(state, snap({ failingChecks: [fail("lint")] }), null);
    expect(first.map((r) => r.kind)).toEqual(["checks"]);
    expect(first[0]?.text).toContain("lint: https://ci/lint");
    expect(computeReactions(state, snap({ failingChecks: [fail("lint")] }), null)).toEqual([]);
    const changed = computeReactions(
      state,
      snap({ failingChecks: [fail("lint"), fail("test")] }),
      null,
    );
    expect(changed).toHaveLength(1);
  });

  it(`caps each kind at ${MAX_PER_KIND} per head SHA; a new head SHA resets`, () => {
    const state = newWatchState(T0);
    for (let i = 0; i < MAX_PER_KIND + 2; i++) {
      computeReactions(state, snap({ failingChecks: [fail(`c${i}`)] }), null);
    }
    expect(state.perKind.checks).toBe(MAX_PER_KIND);
    const afterPush = computeReactions(
      state,
      snap({ headSha: "bbbbbbb2", failingChecks: [fail("c0")] }),
      null,
    );
    expect(afterPush.map((r) => r.kind)).toEqual(["checks"]);
  });

  it(`stops after ${MAX_WAKES} wakes for the whole watch`, () => {
    const state = newWatchState(T0);
    let total = 0;
    for (let sha = 0; sha < 6; sha++) {
      for (let i = 0; i < 3; i++) {
        total += computeReactions(
          state,
          snap({ headSha: `sha${sha}`, failingChecks: [fail(`c${i}`)] }),
          null,
        ).length;
      }
    }
    expect(total).toBe(MAX_WAKES);
  });

  it("skips the agent's own remarks, old feedback and feedback already reported", () => {
    const state = newWatchState(T0);
    const feedback = [
      { id: "comment:1", author: "Me", at: T0 + 1, kind: "comment" as const, body: "mine" },
      { id: "comment:2", author: "bob", at: T0 - 1, kind: "comment" as const, body: "old" },
      {
        id: "inline:3",
        author: "bob",
        at: T0 + 1,
        kind: "inline" as const,
        body: "use a map\nhere",
        location: "src/a.ts:4",
      },
    ];
    const [review] = computeReactions(state, snap({ feedback }), "me");
    expect(review?.kind).toBe("review");
    expect(review?.text).toContain("@bob on src/a.ts:4: use a map here");
    expect(review?.text).not.toContain("mine");
    expect(review?.text).not.toContain("old");
    // Same comments after a push: already reported, not news
    expect(computeReactions(state, snap({ headSha: "new", feedback }), "me")).toEqual([]);
  });

  it("reports conflicts once per head SHA and ignores PRs that are not open", () => {
    const state = newWatchState(T0);
    expect(computeReactions(state, snap({ conflicting: true }), null).map((r) => r.kind)).toEqual([
      "conflict",
    ]);
    expect(computeReactions(state, snap({ conflicting: true }), null)).toEqual([]);
    expect(
      computeReactions(newWatchState(T0), snap({ state: "MERGED", conflicting: true }), null),
    ).toEqual([]);
  });
});
