import { describe, expect, it, vi } from "vitest";
import {
  holdMedia,
  linuxBackend,
  type MediaBackend,
  macBackend,
  type PlayerState,
  parsePlayerctl,
  pauseMedia,
  resumeMedia,
  toResume,
} from "./media-pause";

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

const player = (id: string, status: PlayerState["status"], position = 10): PlayerState => ({
  id,
  status,
  track: `${id}-track`,
  position,
});

function fakeBackend(
  states: PlayerState[][],
): MediaBackend & { paused: string[][]; played: string[][] } {
  const paused: string[][] = [];
  const played: string[][] = [];
  return {
    paused,
    played,
    list: vi.fn(async () => states.shift() ?? []),
    pause: vi.fn(async (ids: string[]) => {
      paused.push(ids);
    }),
    play: vi.fn(async (ids: string[]) => {
      played.push(ids);
    }),
  };
}

describe("pauseMedia", () => {
  it("pauses only the players that are playing", async () => {
    const b = fakeBackend([[player("music", "playing"), player("spotify", "paused")]]);
    const token = await pauseMedia(b);
    expect(b.paused).toEqual([["music"]]);
    expect(token.map((p) => p.id)).toEqual(["music"]);
  });

  it("does nothing when nothing plays, and never throws", async () => {
    const b = fakeBackend([[player("music", "other")]]);
    expect(await pauseMedia(b)).toEqual([]);
    expect(b.pause).not.toHaveBeenCalled();
    const broken = { ...b, list: vi.fn(async () => Promise.reject(new Error("timeout"))) };
    expect(await pauseMedia(broken)).toEqual([]);
  });
});

describe("toResume", () => {
  const token = [player("music", "playing", 10)];

  it("resumes a player still paused on the same track where it was left", () => {
    expect(toResume(token, [player("music", "paused", 10.2)])).toEqual(["music"]);
  });

  it("leaves a player the user restarted, changed, moved or quit", () => {
    expect(toResume(token, [player("music", "playing", 10)])).toEqual([]);
    expect(toResume(token, [{ ...player("music", "paused"), track: "other" }])).toEqual([]);
    expect(toResume(token, [player("music", "paused", 25)])).toEqual([]);
    expect(toResume(token, [])).toEqual([]);
  });
});

describe("resumeMedia", () => {
  it("plays back only what is still in the state it paused", async () => {
    const b = fakeBackend([[player("music", "paused"), player("spotify", "paused")]]);
    await resumeMedia([player("music", "playing")], b);
    expect(b.played).toEqual([["music"]]);
  });

  it("skips the OS when the token is empty", async () => {
    const b = fakeBackend([]);
    await resumeMedia([], b);
    expect(b.list).not.toHaveBeenCalled();
  });
});

describe("holdMedia", () => {
  it("resumes once, on release or on its own after the limit", async () => {
    vi.useFakeTimers();
    try {
      const b = fakeBackend([[player("music", "playing")], [player("music", "paused")]]);
      const release = holdMedia(60_000, b);
      await vi.advanceTimersByTimeAsync(60_000);
      release();
      await vi.runAllTimersAsync();
      expect(b.paused).toEqual([["music"]]);
      expect(b.played).toEqual([["music"]]);
      expect(b.list).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is a no-op without a backend", () => {
    expect(() => holdMedia(1_000, null)()).not.toThrow();
  });
});

describe("macBackend", () => {
  it("asks osascript for the known players and keeps only those", async () => {
    const runner = vi.fn(async (_file: string, _args: string[]) =>
      JSON.stringify([
        { id: "com.spotify.client", status: "playing", track: "t", position: 3 },
        { id: "evil", status: "playing", track: "", position: 0 },
      ]),
    );
    const list = await macBackend(runner).list();
    expect(list).toEqual([
      { id: "com.spotify.client", status: "playing", track: "t", position: 3 },
    ]);
    const args = runner.mock.calls[0]?.[1] ?? [];
    expect(args.slice(0, 2)).toEqual(["-l", "JavaScript"]);
    expect(args.slice(4)).toEqual(["com.apple.Music", "com.spotify.client"]);
  });

  it("reads garbage as no players", async () => {
    expect(await macBackend(async () => "execution error").list()).toEqual([]);
  });
});

describe("linuxBackend", () => {
  it("parses playerctl lines with microsecond positions", () => {
    expect(
      parsePlayerctl("spotify\tPlaying\t/t/1\t5000000\nfirefox.instance9\tPaused\t\t\n"),
    ).toEqual([
      { id: "spotify", status: "playing", track: "/t/1", position: 5 },
      { id: "firefox.instance9", status: "paused", track: "", position: 0 },
    ]);
  });

  it("addresses each player by instance and survives one failing", async () => {
    const runner = vi.fn(async (_file: string, args: string[]) => {
      if (args[1] === "bad") throw new Error("gone");
      return "";
    });
    await linuxBackend(runner).pause(["bad", "spotify"]);
    expect(runner.mock.calls.map((c) => c[1])).toEqual([
      ["-p", "bad", "pause"],
      ["-p", "spotify", "pause"],
    ]);
  });
});
