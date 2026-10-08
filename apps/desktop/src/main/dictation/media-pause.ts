import { z } from "zod";
import { execFileAsync } from "../lib/exec-file";
import { logger } from "../lib/logger";
import { parseJson } from "../lib/parse-json";

/** One player as the OS reports it. `track` and `position` only tell whether the user touched it
 *  during the dictation: they stay in memory and are never logged */
export interface PlayerState {
  id: string;
  status: "playing" | "paused" | "other";
  track: string;
  /** Seconds */
  position: number;
}

export interface MediaBackend {
  list(): Promise<PlayerState[]>;
  pause(ids: string[]): Promise<void>;
  play(ids: string[]): Promise<void>;
}

/** What a dictation paused: resumed only while each is still paused where we left it */
export type MediaToken = PlayerState[];

const TIMEOUT_MS = 2_000;
/** A player the user played and paused again during the dictation has moved further than this */
const POSITION_SLACK_S = 1.5;

export async function pauseMedia(backend: MediaBackend): Promise<MediaToken> {
  try {
    const playing = (await backend.list()).filter((p) => p.status === "playing");
    if (playing.length === 0) return [];
    await backend.pause(playing.map((p) => p.id));
    logger.info(`[Dictation] paused ${playing.length} players`);
    return playing;
  } catch {
    return [];
  }
}

export function toResume(token: MediaToken, now: PlayerState[]): string[] {
  return token
    .filter((was) => {
      const cur = now.find((p) => p.id === was.id);
      return (
        cur?.status === "paused" &&
        cur.track === was.track &&
        Math.abs(cur.position - was.position) <= POSITION_SLACK_S
      );
    })
    .map((p) => p.id);
}

export async function resumeMedia(token: MediaToken, backend: MediaBackend): Promise<void> {
  if (token.length === 0) return;
  try {
    const ids = toResume(token, await backend.list());
    if (ids.length > 0) await backend.play(ids);
  } catch {
    // The player quit or refused: nothing to give back
  }
}

/** Pauses in the background and returns the release, idempotent; it also runs on its own after
 *  `maxMs` in case no end ever arrives (the renderer died mid-dictation) */
export function holdMedia(
  maxMs: number,
  backend: MediaBackend | null = mediaBackend(),
): () => void {
  if (!backend) return () => {};
  const paused = pauseMedia(backend);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    void paused.then((token) => resumeMedia(token, backend));
  };
  const timer = setTimeout(release, maxMs);
  timer.unref?.();
  return release;
}

export function mediaBackend(): MediaBackend | null {
  if (process.platform === "darwin") return macBackend(run);
  if (process.platform === "linux") return linuxBackend(run);
  return null;
}

export type Runner = (file: string, args: string[]) => Promise<string>;

const run: Runner = async (file, args) =>
  (await execFileAsync(file, args, { timeout: TIMEOUT_MS, encoding: "utf8" })).stdout;

// MediaRemote answers only Apple-entitled processes since macOS 15.4, so each player is asked
// over Apple Events. `running()` never launches an app; every other call needs Automation consent
const MAC_PLAYERS = ["com.apple.Music", "com.spotify.client"];

const MAC_LIST = `function run(argv) {
  const out = [];
  for (const id of argv) {
    try {
      const app = Application(id);
      if (!app.running()) continue;
      const p = { id: id, status: String(app.playerState()), track: "", position: 0 };
      try { p.track = String(id === "com.spotify.client" ? app.currentTrack.id() : app.currentTrack.persistentID()); } catch (e) {}
      try { p.position = Number(app.playerPosition()) || 0; } catch (e) {}
      out.push(p);
    } catch (e) {}
  }
  return JSON.stringify(out);
}`;

const macAction = (verb: "pause" | "play") => `function run(argv) {
  for (const id of argv) {
    try { const app = Application(id); if (app.running()) app.${verb}(); } catch (e) {}
  }
}`;

const macListSchema = z.array(
  z.object({ id: z.string(), status: z.string(), track: z.string(), position: z.number() }),
);

const statusOf = (s: string): PlayerState["status"] => {
  const v = s.toLowerCase();
  return v === "playing" || v === "paused" ? v : "other";
};

export function macBackend(runner: Runner): MediaBackend {
  const osa = (script: string, ids: string[]) =>
    runner("/usr/bin/osascript", ["-l", "JavaScript", "-e", script, ...ids]);
  return {
    async list() {
      const parsed = parseJson((await osa(MAC_LIST, MAC_PLAYERS)).trim(), macListSchema) ?? [];
      return parsed
        .filter((p) => MAC_PLAYERS.includes(p.id))
        .map((p) => ({ ...p, status: statusOf(p.status) }));
    },
    async pause(ids) {
      await osa(macAction("pause"), ids);
    },
    async play(ids) {
      await osa(macAction("play"), ids);
    },
  };
}

/** MPRIS through playerctl when it is installed; each player is addressed by its instance name */
export function linuxBackend(runner: Runner): MediaBackend {
  const each = (verb: string, ids: string[]) =>
    Promise.allSettled(ids.map((id) => runner("playerctl", ["-p", id, verb]))).then(() => {});
  return {
    async list() {
      const out = await runner("playerctl", [
        "-a",
        "metadata",
        "--format",
        "{{playerInstance}}\t{{status}}\t{{mpris:trackid}}\t{{position}}",
      ]);
      return parsePlayerctl(out);
    },
    pause: (ids) => each("pause", ids),
    play: (ids) => each("play", ids),
  };
}

export function parsePlayerctl(out: string): PlayerState[] {
  return out
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([id]) => !!id?.trim())
    .map(([id = "", status = "", track = "", position = ""]) => ({
      id: id.trim(),
      status: statusOf(status.trim()),
      track: track.trim(),
      position: (Number(position) || 0) / 1_000_000,
    }));
}
