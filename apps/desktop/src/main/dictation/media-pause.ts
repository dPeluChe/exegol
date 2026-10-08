import { execFile, spawn } from "node:child_process";
import { z } from "zod";
import { logger } from "../lib/logger";
import { parseJson } from "../lib/parse-json";

/** A fixed script plus data as argv: track data never becomes code */
export interface Command {
  file: string;
  args: string[];
}

/** What a pause did: how many players, and the script that gives them back. That script checks
 *  each one is still paused on the same track and position before it sends play */
export interface Paused {
  count: number;
  resume: Command;
}

export interface MediaBackend {
  pause(): Promise<Paused | null>;
}

export type Runner = (
  cmd: Command,
  opts?: { timeoutMs?: number; partial?: boolean },
) => Promise<string>;

const TIMEOUT_MS = 2_000;
const CONSENT_TIMEOUT_MS = 60_000;
/** A player the user played and paused again during the dictation has moved further than this */
const SLACK_S = 1.5;

export const run: Runner = (cmd, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd.file,
      cmd.args,
      { timeout: opts.timeoutMs ?? TIMEOUT_MS, encoding: "utf8" },
      (err, stdout) => {
        // playerctl -a exits non-zero when one player fails, after printing the others
        if (err && !(opts.partial && stdout)) reject(err);
        else resolve(stdout);
      },
    );
  });

// ─── Hold: one at a time, every pause and resume in order ──────────────────────

interface Hold {
  paused: Promise<Paused | null>;
  /** Set once the pause answered: the quit path needs it synchronously */
  done: Paused | null;
  released: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface MediaHold {
  release(): void;
  /** Restarts the safety timer; false once released (a replacing dictation then holds anew) */
  extend(maxMs: number): boolean;
}

let chain: Promise<unknown> = Promise.resolve();
let live: Hold | null = null;
/** Released, resume not started yet: a dictation starting now takes its pause over */
let waiting: Hold | null = null;

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

/** Pauses in the background; the release also runs on its own after `maxMs` in case no end
 *  ever arrives (the renderer died mid-dictation) */
export function holdMedia(
  maxMs: number,
  backend: MediaBackend | null,
  runner: Runner = run,
): MediaHold {
  let paused: Promise<Paused | null>;
  if (waiting) {
    paused = waiting.paused;
    waiting = null;
  } else if (backend) {
    paused = serial(() => backend.pause().catch(() => null));
    void paused.then((p) => {
      if (p) logger.info(`[Dictation] paused ${p.count} players`);
    });
  } else {
    paused = Promise.resolve(null);
  }
  const hold: Hold = { paused, done: null, released: false, timer: null };
  void paused.then((p) => {
    hold.done = p;
  });
  live = hold;
  const arm = (ms: number) => {
    if (hold.timer) clearTimeout(hold.timer);
    hold.timer = setTimeout(() => release(hold, runner), ms);
    hold.timer.unref?.();
  };
  arm(maxMs);
  return {
    release: () => release(hold, runner),
    extend: (ms) => {
      if (hold.released) return false;
      arm(ms);
      return true;
    },
  };
}

function release(hold: Hold, runner: Runner): void {
  if (hold.released) return;
  hold.released = true;
  if (hold.timer) clearTimeout(hold.timer);
  if (live === hold) live = null;
  waiting = hold;
  void hold.paused.then((p) =>
    serial(async () => {
      if (waiting !== hold) return;
      waiting = null;
      if (p) await runner(p.resume).catch(() => {});
    }),
  );
}

/** Quit: the app will not live to await, so the resume runs in a detached process */
export function releaseMediaNow(): void {
  for (const hold of [live, waiting]) {
    if (!hold) continue;
    hold.released = true;
    if (hold.timer) clearTimeout(hold.timer);
    if (hold.done) {
      spawn(hold.done.resume.file, hold.done.resume.args, {
        detached: true,
        stdio: "ignore",
      }).unref();
    }
  }
  live = null;
  waiting = null;
}

/** Tests only */
export function resetMediaHolds(): void {
  live = null;
  waiting = null;
  chain = Promise.resolve();
}

export function mediaBackend(opts: { direct: boolean }, runner: Runner = run): MediaBackend | null {
  if (process.platform === "darwin") return macBackend(runner, opts.direct);
  if (process.platform === "linux") return linuxBackend(runner);
  return null;
}

// ─── macOS ─────────────────────────────────────────────────────────────────────

// MediaRemote answers only Apple-entitled processes since macOS 15.4; /usr/bin/perl is one, and
// its ObjC bridge reaches the framework with no compiled code. Hosting in perl is the technique of
// ungive/mediaremote-adapter (BSD-3-Clause); no code of it is used here
const PERL = "/usr/bin/perl";
const NOW_PLAYING = `
use strict;
use Foundation;
use Digest::MD5 qw(md5_hex);
my $fw = NSBundle->bundleWithPath_("/System/Library/PrivateFrameworks/MediaRemote.framework");
exit 3 unless $fw && $$fw && $fw->load;
@MRNowPlayingRequest::ISA = ("PerlObjCBridge");
@MRNowPlayingController::ISA = ("PerlObjCBridge");
sub ok { my $o = shift; return $o && $$o }
sub field {
  my ($info, $key) = @_;
  my $v = $info->objectForKey_("kMRMediaRemoteNowPlayingInfo" . $key);
  return ok($v) ? $v->description->UTF8String : "";
}
# (playing, app, track hash, elapsed seconds) or () when no app is playing anything
sub now_playing {
  my $path = MRNowPlayingRequest->localNowPlayingPlayerPath;
  my $client = ok($path) ? $path->client : undef;
  return () unless ok($client);
  my $id = $client->bundleIdentifier;
  my $app = ok($id) ? $id->UTF8String : "pid" . $client->processIdentifier;
  my ($track, $at) = ("", 0);
  my $item = MRNowPlayingRequest->localNowPlayingItem;
  my $info = ok($item) ? $item->nowPlayingInfo : undef;
  if (ok($info)) {
    $track = md5_hex(join("\\0", map { field($info, $_) } qw(Title Artist Album)));
    my $e = $info->objectForKey_("kMRMediaRemoteNowPlayingInfoElapsedTime");
    $at = $e->doubleValue if ok($e);
    my $rate = $info->objectForKey_("kMRMediaRemoteNowPlayingInfoPlaybackRate");
    my $ts = $info->objectForKey_("kMRMediaRemoteNowPlayingInfoTimestamp");
    $at -= $ts->timeIntervalSinceNow * $rate->doubleValue if ok($rate) && ok($ts) && $rate->doubleValue > 0;
  }
  return (MRNowPlayingRequest->localIsPlaying ? 1 : 0, $app, $track, $at);
}
sub wait_for { NSRunLoop->currentRunLoop->runUntilDate_(NSDate->dateWithTimeIntervalSinceNow_($_[0])) }
# kMRPlay = 0, kMRPause = 1; never the toggle
sub command {
  MRNowPlayingController->localRouteController->sendCommand_options_completion_($_[0], undef, undef);
  wait_for(0.2);
}
`;

const MR_PAUSE = `${NOW_PLAYING}
my ($playing, $app) = now_playing();
if (!$playing) { print "none\\n"; exit 0 }
command(1);
for (1 .. 8) {
  my ($still, $now, $track, $at) = now_playing();
  if (defined $now && !$still && $now eq $app) { printf "paused\\t%s\\t%s\\t%.3f\\n", $app, $track, $at; exit 0 }
  wait_for(0.1);
}
print "none\\n";
`;

const MR_RESUME = `${NOW_PLAYING}
my ($app, $track, $at) = @ARGV;
my ($playing, $now, $nowTrack, $nowAt) = now_playing();
exit 0 if !defined $now || $playing || $now ne $app || $nowTrack ne $track;
exit 0 if abs($nowAt - $at) > ${SLACK_S};
command(0);
`;

const MAC_PLAYERS = ["com.apple.Music", "com.spotify.client"];
const JXA_TRACK = `function trackOf(app, id) {
  let track = "", position = 0;
  try { track = String(id === "com.spotify.client" ? app.currentTrack.id() : app.currentTrack.persistentID()); } catch (e) {}
  try { position = Number(app.playerPosition()) || 0; } catch (e) {}
  return [track, position];
}
const PLAYERS = ${JSON.stringify(MAC_PLAYERS)};`;

// running() never launches an app; every other call needs Automation consent
const JXA_PAUSE = `${JXA_TRACK}
function run() {
  const out = [];
  for (const id of PLAYERS) {
    try {
      const app = Application(id);
      if (!app.running() || String(app.playerState()) !== "playing") continue;
      const [track, position] = trackOf(app, id);
      app.pause();
      out.push([id, track, String(position)]);
    } catch (e) {}
  }
  return JSON.stringify(out);
}`;

const JXA_RESUME = `${JXA_TRACK}
function run(argv) {
  for (let i = 0; i + 2 < argv.length; i += 3) {
    const id = argv[i];
    if (!PLAYERS.includes(id)) continue;
    try {
      const app = Application(id);
      if (!app.running() || String(app.playerState()) !== "paused") continue;
      const [track, position] = trackOf(app, id);
      if (track === argv[i + 1] && Math.abs(position - (Number(argv[i + 2]) || 0)) <= ${SLACK_S}) app.play();
    } catch (e) {}
  }
}`;

const JXA_CONSENT = `const PLAYERS = ${JSON.stringify(MAC_PLAYERS)};
function run() {
  let asked = 0;
  for (const id of PLAYERS) {
    try { const app = Application(id); if (app.running()) { app.playerState(); asked++; } } catch (e) {}
  }
  return String(asked);
}`;

const osa = (script: string, args: string[] = []): Command => ({
  file: "/usr/bin/osascript",
  args: ["-l", "JavaScript", "-e", script, ...args],
});

const mrPausedSchema = z.tuple([z.literal("paused"), z.string(), z.string(), z.string()]);
const jxaPausedSchema = z.array(z.tuple([z.string(), z.string(), z.string()]));

export function parseMrPause(out: string): Paused | null {
  const parsed = mrPausedSchema.safeParse(out.trim().split("\t"));
  if (!parsed.success) return null;
  const [, app, track, at] = parsed.data;
  return { count: 1, resume: { file: PERL, args: ["-e", MR_RESUME, "--", app, track, at] } };
}

export function parseJxaPause(out: string): Paused | null {
  const players = (parseJson(out.trim(), jxaPausedSchema) ?? []).filter(([id]) =>
    MAC_PLAYERS.includes(id),
  );
  if (players.length === 0) return null;
  return { count: players.length, resume: osa(JXA_RESUME, players.flat()) };
}

/** System Now Playing first (any app, browsers included, no prompt); Music and Spotify over
 *  Apple Events only when the user allowed it and Now Playing paused nothing */
export function macBackend(runner: Runner, direct: boolean): MediaBackend {
  return {
    async pause() {
      try {
        const paused = parseMrPause(await runner({ file: PERL, args: ["-e", MR_PAUSE] }));
        if (paused) return paused;
      } catch {
        // perl, its bridge or MediaRemote is gone: the direct path may still work
      }
      if (!direct) return null;
      try {
        return parseJxaPause(await runner(osa(JXA_PAUSE)));
      } catch {
        return null;
      }
    },
  };
}

/** Settings toggle: macOS asks for Automation now rather than mid-dictation (only for a player
 *  that is running; the others ask on first use). Returns how many were asked */
export async function askMediaConsent(runner: Runner = run): Promise<{ asked: number }> {
  if (process.platform !== "darwin") return { asked: 0 };
  try {
    const out = await runner(osa(JXA_CONSENT), { timeoutMs: CONSENT_TIMEOUT_MS });
    return { asked: Number(out.trim()) || 0 };
  } catch {
    return { asked: 0 };
  }
}

// ─── Linux ─────────────────────────────────────────────────────────────────────

const PLAYERCTL_FORMAT = "{{playerInstance}}\t{{status}}\t{{mpris:trackid}}\t{{position}}";

// argv: instance, track id, position in microseconds, repeated
const LINUX_RESUME = `
while [ $# -ge 3 ]; do
  id=$1; track=$2; pos=$3; shift 3
  line=$(playerctl -p "$id" metadata --format '{{status}}\t{{mpris:trackid}}\t{{position}}' 2>/dev/null) || continue
  status=\${line%%\t*}; now=\${line##*\t}; rest=\${line#*\t}; now_track=\${rest%\t*}
  [ "$status" = Paused ] && [ "$now_track" = "$track" ] || continue
  case $now in ''|*[!0-9]*) now=0 ;; esac
  d=$((now - pos)); [ $d -lt 0 ] && d=$((0 - d))
  [ $d -le ${SLACK_S * 1_000_000} ] && playerctl -p "$id" play
done
`;

export interface MprisPlayer {
  id: string;
  status: string;
  track: string;
  /** Microseconds, digits only */
  position: string;
}

export function parsePlayerctl(out: string): MprisPlayer[] {
  return out
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((cols) => cols.length === 4 && !!cols[0]?.trim())
    .map(([id = "", status = "", track = "", position = ""]) => ({
      id: id.trim(),
      status: status.trim(),
      track: track.trim(),
      position: /^\d+$/.test(position.trim()) ? position.trim() : "0",
    }));
}

export const linuxResume = (players: MprisPlayer[]): Command => ({
  file: "/bin/sh",
  args: ["-c", LINUX_RESUME, "sh", ...players.flatMap((p) => [p.id, p.track, p.position])],
});

/** MPRIS through playerctl when it is installed; each player is addressed by its instance name */
export function linuxBackend(runner: Runner): MediaBackend {
  return {
    async pause() {
      const out = await runner(
        { file: "playerctl", args: ["-a", "metadata", "--format", PLAYERCTL_FORMAT] },
        { partial: true },
      );
      const playing = parsePlayerctl(out).filter((p) => p.status === "Playing");
      const results = await Promise.allSettled(
        playing.map((p) => runner({ file: "playerctl", args: ["-p", p.id, "pause"] })),
      );
      const paused = playing.filter((_, i) => results[i]?.status === "fulfilled");
      return paused.length > 0 ? { count: paused.length, resume: linuxResume(paused) } : null;
    },
  };
}
