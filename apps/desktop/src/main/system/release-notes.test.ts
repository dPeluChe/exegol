import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ net: { fetch: vi.fn() } }));
const { notesBetween } = await import("./release-notes");

const rel = (tag: string, extra: Partial<{ draft: boolean; prerelease: boolean }> = {}) => ({
  tag_name: tag,
  published_at: "2026-09-29T00:00:00Z",
  body: `notes ${tag}`,
  draft: false,
  prerelease: false,
  ...extra,
});

describe("notesBetween", () => {
  it("lists every version after the running one up to the new one, newest first", () => {
    const releases = [rel("v0.5.4"), rel("v0.5.7"), rel("v0.5.5"), rel("v0.5.6"), rel("v0.5.8")];
    expect(notesBetween(releases, "0.5.4", "0.5.7").map((n) => n.version)).toEqual([
      "0.5.7",
      "0.5.6",
      "0.5.5",
    ]);
  });

  it("skips drafts, prereleases and tags that are not versions", () => {
    const releases = [
      rel("v0.5.7"),
      rel("v0.5.6", { draft: true }),
      rel("v0.5.5", { prerelease: true }),
      rel("desktop-canary"),
    ];
    expect(notesBetween(releases, "0.5.4", "0.5.7").map((n) => n.version)).toEqual(["0.5.7"]);
  });

  it("keeps the body and date", () => {
    expect(notesBetween([rel("v0.5.7")], null, "0.5.7")).toEqual([
      { version: "0.5.7", date: "2026-09-29T00:00:00Z", body: "notes v0.5.7" },
    ]);
  });
});
