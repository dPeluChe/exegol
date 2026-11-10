import { randomUUID } from "node:crypto";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import type { SpeechAudioEvent, SpeechEndEvent, VoiceModelEntry } from "@exegol/shared";
import { type UtilityProcess, utilityProcess, type WebContents } from "electron";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { MODELS_DIR, modelDir } from "../models/manager";
import { type AudioChunk, CACHE_MAX_BYTES, clipKey, getClip, putClip } from "./audio-cache";
import { ttsSpec, voiceOf } from "./tts-config";
import type { TtsReply, TtsRequest } from "./tts-protocol";

/** Freed sooner than dictation: replies are read now and then; loaded, it holds ~500 MB */
const IDLE_MS = 3 * 60_000;
const RESPAWN_LIMIT = 3;

interface Utterance {
  id: string;
  /** null: made ahead of time, for the cache only */
  sender: WebContents | null;
  key: string;
  wanted: number;
  chunks: AudioChunk[];
  bytes: number;
  startedAt: number;
  firstAudioMs: number | null;
  onGone: () => void;
}

let child: UtilityProcess | null = null;
let current: Utterance | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let crashes = 0;

function send(message: TtsRequest): void {
  child?.postMessage(message);
}

function toSender(u: Utterance, channel: string, payload: SpeechAudioEvent | SpeechEndEvent) {
  if (u.sender && !u.sender.isDestroyed()) u.sender.send(channel, payload);
}

function end(u: Utterance, outcome: { error?: string; stopped?: boolean } = {}): void {
  if (current === u) current = null;
  u.sender?.off("destroyed", u.onGone);
  toSender(u, "speech:end", { id: u.id, ...outcome });
  touch();
}

function onReply(msg: TtsReply): void {
  const u = current;
  if (!u || u.id !== msg.id) return;
  switch (msg.type) {
    case "audio":
      u.firstAudioMs ??= Date.now() - u.startedAt;
      // A read too long to keep stops collecting: putClip would refuse it anyway
      if (u.bytes <= CACHE_MAX_BYTES) {
        u.chunks.push({ samples: msg.samples, sampleRate: msg.sampleRate });
        u.bytes += msg.samples.byteLength;
      }
      toSender(u, "speech:audio", { id: u.id, samples: msg.samples, sampleRate: msg.sampleRate });
      return;
    case "done":
      crashes = 0;
      if (msg.sentences === u.wanted) putClip(u.key, u.chunks);
      logger.info(
        `[Speech] ${u.sender ? "read" : "prepared"} ${msg.sentences} sentence(s): first audio ${u.firstAudioMs ?? "-"}ms, load ${msg.loadMs}ms, synth ${msg.synthMs}ms`,
      );
      end(u);
      return;
    case "failed":
      if (msg.error !== "cancelled") logger.warn(`[Speech] synthesis failed: ${msg.error}`);
      end(u, { error: "The voice could not read this reply" });
      return;
  }
}

function spawn(): UtilityProcess {
  const proc = utilityProcess.fork(
    join(__dirname, "speech-engine.js"),
    [`--models-root=${MODELS_DIR}`],
    { serviceName: "Exegol Speech", stdio: "ignore" },
  );
  proc.on("message", (msg: TtsReply) => onReply(msg));
  proc.on("exit", (code) => {
    if (child !== proc) return;
    child = null;
    if (code !== 0) {
      crashes++;
      logger.warn(`[Speech] engine exited with code ${code}`);
    }
    if (current) end(current, { error: "The voice engine stopped" });
  });
  return proc;
}

function touch(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!current) stopSpeechEngine();
  }, IDLE_MS);
  idleTimer.unref?.();
}

interface UtteranceInput {
  entry: VoiceModelEntry;
  voiceId: string;
  speed: number;
  sentences: string[];
}

/** Kept audio to a window, then its end */
function replay(sender: WebContents, id: string, chunks: AudioChunk[]): void {
  if (sender.isDestroyed()) return;
  for (const chunk of chunks) sender.send("speech:audio", { id, ...chunk });
  sender.send("speech:end", { id });
  logger.info(`[Speech] played ${chunks.length} prepared sentence(s)`);
}

/** The reply being prepared is the one asked for: the window gets what is made so far and
 *  the rest as it comes, instead of starting over */
function adopt(u: Utterance, sender: WebContents): string {
  // After the id reached the window: it tells its audio by that id
  setImmediate(() => {
    if (current !== u) {
      const clip = getClip(u.key);
      if (clip) replay(sender, u.id, clip);
      else if (!sender.isDestroyed()) sender.send("speech:end", { id: u.id, stopped: true });
      return;
    }
    for (const chunk of u.chunks) sender.send("speech:audio", { id: u.id, ...chunk });
    u.sender = sender;
    sender.once("destroyed", u.onGone);
  });
  return u.id;
}

function begin(opts: UtteranceInput, sender: WebContents | null): string | null {
  const voice = voiceOf(opts.entry, opts.voiceId);
  if (!voice) return null;
  const key = clipKey(opts.sentences, voice.id, opts.speed);
  const ready = getClip(key);
  if (!sender && (ready || current)) return null;
  if (sender && !ready && current && !current.sender && current.key === key) {
    return adopt(current, sender);
  }
  stopUtterance();
  const id = randomUUID();
  if (ready && sender) {
    setImmediate(() => replay(sender, id, ready));
    return id;
  }
  if (crashes >= RESPAWN_LIMIT) return null;
  const u: Utterance = {
    id,
    sender,
    key,
    wanted: opts.sentences.length,
    chunks: [],
    bytes: 0,
    startedAt: Date.now(),
    firstAudioMs: null,
    onGone: () => stopUtterance(id),
  };
  current = u;
  sender?.once("destroyed", u.onGone);
  const threads = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
  child ??= spawn();
  send({
    type: "speak",
    id,
    spec: ttsSpec(opts.entry, modelDir(opts.entry.id), voice, threads),
    sid: voice.speakerId,
    speed: opts.speed,
    sentences: opts.sentences,
  });
  touch();
  return id;
}

/** Starts reading `sentences` for `sender`; any utterance playing stops first. Audio made
 *  before plays at once */
export const startUtterance = (opts: UtteranceInput & { sender: WebContents }): string | null =>
  begin(opts, opts.sender);

/** Makes the audio ahead of time, only while nothing else is being read */
export const prepareUtterance = (opts: UtteranceInput): boolean => begin(opts, null) !== null;

/** Stops the given utterance, or whichever plays */
export function stopUtterance(id?: string): void {
  const u = current;
  if (!u || (id && u.id !== id)) return;
  send({ type: "cancel", id: u.id });
  end(u, { stopped: true });
}

/** Synthesis stops and every window drops the audio it still holds: a finished clip keeps playing otherwise */
export function hushSpeech(): void {
  stopUtterance();
  broadcast("speech:end", { id: "", stopped: true, all: true });
}

/** Frees the model: the process (and its memory) goes away */
export function stopSpeechEngine(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  stopUtterance();
  const proc = child;
  child = null;
  proc?.kill();
}
