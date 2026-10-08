import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Command,
  holdMedia,
  linuxBackend,
  linuxResume,
  type MediaBackend,
  macBackend,
  type Paused,
  parseJxaPause,
  parseMrPause,
  parsePlayerctl,
  type Runner,
  releaseMediaNow,
  resetMediaHolds,
} from "./media-pause";

const spawned = vi.hoisted(() => [] as { file: string; args: string[]; opts: unknown }[]);
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  spawn: (file: string, args: string[], opts: unknown) => {
    spawned.push({ file, args, opts });
    return { unref: () => {} };
  },
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

const resumeCmd = (tag: string): Command => ({ file: "resume", args: [tag] });
const pausedAs = (tag: string): Paused => ({ count: 1, resume: resumeCmd(tag) });

describe("macBackend", () => {
  const mrOut = "paused\tcompany.thebrowser.Browser\tabc123\t42.500\n";

  it("uses system Now Playing first and resumes through a fixed perl script with data argv", async () => {
    const runner = vi.fn<Runner>(async () => mrOut);
    const paused = await macBackend(runner, true).pause();
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[0].file).toBe("/usr/bin/perl");
    expect(paused?.count).toBe(1);
    expect(paused?.resume.file).toBe("/usr/bin/perl");
    expect(paused?.resume.args.slice(2)).toEqual([
      "--",
      "company.thebrowser.Browser",
      "abc123",
      "42.500",
    ]);
    expect(paused?.resume.args[1]).not.toContain("abc123");
  });

  it("stops at Now Playing when direct control is off", async () => {
    const runner = vi.fn<Runner>(async () => "none\n");
    expect(await macBackend(runner, false).pause()).toBeNull();
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("falls back to Music and Spotify when perl fails or pauses nothing", async () => {
    const jxa = JSON.stringify([["com.spotify.client", "spotify:track:1", "12.5"]]);
    const runner = vi.fn<Runner>(async (cmd) => {
      if (cmd.file === "/usr/bin/perl") throw new Error("exit 3");
      return jxa;
    });
    const paused = await macBackend(runner, true).pause();
    expect(runner.mock.calls[1]?.[0].file).toBe("/usr/bin/osascript");
    expect(paused?.resume.args.slice(4)).toEqual(["com.spotify.client", "spotify:track:1", "12.5"]);
  });

  it("reads garbage as nothing paused", () => {
    expect(parseMrPause("execution error")).toBeNull();
    expect(parseMrPause("paused\tonly-two")).toBeNull();
    expect(parseJxaPause("nope")).toBeNull();
    expect(parseJxaPause(JSON.stringify([["evil.app", "", "0"]]))).toBeNull();
  });
});

describe("linuxBackend", () => {
  it("parses playerctl lines; positions stay digits only", () => {
    expect(
      parsePlayerctl("spotify\tPlaying\t/t/1\t5000000\nfirefox.instance9\tPaused\t\t\nbad"),
    ).toEqual([
      { id: "spotify", status: "Playing", track: "/t/1", position: "5000000" },
      { id: "firefox.instance9", status: "Paused", track: "", position: "0" },
    ]);
  });

  it("reads partial output and keeps only the players it really paused", async () => {
    const runner = vi.fn<Runner>(async (cmd) => {
      if (cmd.args[0] === "-a")
        return "a\tPlaying\t/t/a\t1\nb\tPlaying\t/t/b\t2\nc\tPaused\t/t/c\t3\n";
      if (cmd.args[1] === "a") throw new Error("gone");
      return "";
    });
    const paused = await linuxBackend(runner).pause();
    expect(runner.mock.calls[0]?.[1]).toEqual({ partial: true });
    expect(runner.mock.calls.slice(1).map((c) => c[0].args)).toEqual([
      ["-p", "a", "pause"],
      ["-p", "b", "pause"],
    ]);
    expect(paused?.count).toBe(1);
    expect(paused?.resume.args.slice(3)).toEqual(["b", "/t/b", "2"]);
  });
});

describe.skipIf(process.platform === "win32")("linux resume script", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "exegol-mpris-"));
    // Fake playerctl: state lines "id<TAB>status<TAB>track<TAB>position", plays logged
    writeFileSync(
      join(dir, "playerctl"),
      `#!/bin/sh
id=$2
case $3 in
  metadata) grep "^$id	" "${dir}/state" | cut -f2- ;;
  play) echo "$id" >> "${dir}/played" ;;
esac
`,
    );
    chmodSync(join(dir, "playerctl"), 0o755);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const resumeWith = (state: string, token: [string, string, string][]): string[] => {
    writeFileSync(join(dir, "state"), state);
    const cmd = linuxResume(
      token.map(([id, track, position]) => ({ id, status: "", track, position })),
    );
    execFileSync(cmd.file, cmd.args, { env: { PATH: `${dir}:/usr/bin:/bin` } });
    try {
      return readFileSync(join(dir, "played"), "utf8").trim().split("\n");
    } catch {
      return [];
    }
  };

  it("plays only what is still paused on the same track and position", () => {
    const state = [
      "same\tPaused\t/t/1\t10500000",
      "moved\tPaused\t/t/1\t30000000",
      "playing\tPlaying\t/t/1\t10000000",
      "other\tPaused\t/t/2\t10000000",
      "radio\tPaused\t/t/r\t",
    ].join("\n");
    const played = resumeWith(state, [
      ["same", "/t/1", "10000000"],
      ["moved", "/t/1", "10000000"],
      ["playing", "/t/1", "10000000"],
      ["other", "/t/1", "10000000"],
      ["radio", "/t/r", "0"],
      ["gone", "/t/1", "0"],
    ]);
    expect(played).toEqual(["same", "radio"]);
  });
});

describe("holdMedia", () => {
  beforeEach(() => {
    resetMediaHolds();
    spawned.length = 0;
  });

  const backendOf = (
    ...results: (Paused | null)[]
  ): MediaBackend & { pause: ReturnType<typeof vi.fn> } => ({
    pause: vi.fn(async () => results.shift() ?? null),
  });

  it("resumes once, with the script the pause returned", async () => {
    const runner = vi.fn<Runner>(async () => "");
    const hold = holdMedia(60_000, backendOf(pausedAs("a")), runner);
    hold.release();
    hold.release();
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
    expect(runner.mock.calls[0]?.[0]).toEqual(resumeCmd("a"));
    expect(hold.extend(1_000)).toBe(false);
  });

  it("a new dictation takes over a pause whose resume has not run", async () => {
    const runner = vi.fn<Runner>(async () => "");
    const backend = backendOf(pausedAs("a"), pausedAs("b"));
    holdMedia(60_000, backend, runner).release();
    const next = holdMedia(60_000, backend, runner);
    await new Promise((r) => setTimeout(r, 10));
    expect(runner).not.toHaveBeenCalled();
    expect(backend.pause).toHaveBeenCalledTimes(1);
    next.release();
    await vi.waitFor(() => expect(runner).toHaveBeenCalledWith(resumeCmd("a")));
  });

  it("a pause after a resume started waits for it", async () => {
    const order: string[] = [];
    let finish = () => {};
    const runner = vi.fn<Runner>(
      () =>
        new Promise((r) => {
          order.push("resume");
          finish = () => r("");
        }),
    );
    const backend: MediaBackend = {
      pause: vi.fn(async () => {
        order.push("pause");
        return pausedAs("x");
      }),
    };
    holdMedia(60_000, backend, runner).release();
    await vi.waitFor(() => expect(order).toEqual(["pause", "resume"]));
    holdMedia(60_000, backend, runner);
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["pause", "resume"]);
    finish();
    await vi.waitFor(() => expect(order).toEqual(["pause", "resume", "pause"]));
  });

  it("releases on its own after the limit unless extended", async () => {
    vi.useFakeTimers();
    try {
      const runner = vi.fn<Runner>(async () => "");
      const hold = holdMedia(1_000, backendOf(pausedAs("a")), runner);
      await vi.advanceTimersByTimeAsync(800);
      expect(hold.extend(1_000)).toBe(true);
      await vi.advanceTimersByTimeAsync(800);
      expect(runner).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);
      expect(runner).toHaveBeenCalledTimes(1);
      expect(hold.extend(1_000)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("on quit, hands the resume to a detached process", async () => {
    const runner = vi.fn<Runner>(async () => "");
    holdMedia(60_000, backendOf(pausedAs("q")), runner);
    await new Promise((r) => setTimeout(r, 10));
    releaseMediaNow();
    expect(spawned).toEqual([
      { file: "resume", args: ["q"], opts: { detached: true, stdio: "ignore" } },
    ]);
    releaseMediaNow();
    expect(spawned).toHaveLength(1);
  });

  it("is a no-op without a backend or when nothing was playing", async () => {
    const runner = vi.fn<Runner>(async () => "");
    holdMedia(1_000, null, runner).release();
    holdMedia(1_000, backendOf(null), runner).release();
    await new Promise((r) => setTimeout(r, 10));
    expect(runner).not.toHaveBeenCalled();
  });
});
