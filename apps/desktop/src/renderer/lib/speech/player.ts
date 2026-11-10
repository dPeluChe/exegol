import type { SpeakResult, SpeechAudioEvent, SpeechEndEvent } from "@exegol/shared";
import { useSyncExternalStore } from "react";
import { useToastStore } from "../../stores/toasts";
import { addWaiting, type WaitingReply } from "./waiting";

/** What plays: `key` names the reply (a chat turn id), `id` the main process utterance */
interface Playing {
  key: string;
  id: string | null;
}

let playing: Playing | null = null;
let ctx: AudioContext | null = null;
let sources: AudioBufferSourceNode[] = [];
let nextAt = 0;
let mainDone = false;
let early: SpeechAudioEvent[] = [];
let listening = false;
let waiting: WaitingReply[] = [];
const subscribers = new Set<() => void>();

function emit(): void {
  for (const fn of subscribers) fn();
}

function silence(): void {
  for (const s of sources) {
    s.onended = null;
    try {
      s.stop();
    } catch {}
  }
  sources = [];
  early = [];
  nextAt = 0;
  mainDone = false;
}

/** `next`: the reading ended by itself, so the reply that waited behind it starts; a stop drops them */
function finish(next = false): void {
  silence();
  playing = null;
  const up = next ? waiting.shift() : undefined;
  if (!next) waiting = [];
  emit();
  if (up) void start(up);
}

function enqueue(event: SpeechAudioEvent): void {
  ctx ??= new AudioContext();
  void ctx.resume();
  const buffer = ctx.createBuffer(1, event.samples.length, event.sampleRate);
  // IPC delivers a structured-clone copy: a Float32Array on its own (non-shared) ArrayBuffer
  buffer.copyToChannel(event.samples as Float32Array<ArrayBuffer>, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  const at = Math.max(ctx.currentTime + 0.05, nextAt);
  source.start(at);
  nextAt = at + buffer.duration;
  sources.push(source);
  source.onended = () => {
    sources = sources.filter((s) => s !== source);
    if (mainDone && sources.length === 0) finish(true);
  };
}

function onAudio(event: SpeechAudioEvent): void {
  if (!playing) return;
  if (playing.id === null) early.push(event);
  else if (event.id === playing.id) enqueue(event);
}

function onEnd(event: SpeechEndEvent): void {
  if (!playing || playing.id !== event.id) return;
  if (event.error || event.stopped) {
    if (event.error) useToastStore.getState().addToast({ type: "warning", title: event.error });
    finish(!event.stopped);
    return;
  }
  mainDone = true;
  if (sources.length === 0) finish(true);
}

function listen(): void {
  if (listening || !window.api?.speech) return;
  listening = true;
  window.api.speech.onAudio(onAudio);
  window.api.speech.onEnd(onEnd);
  window.addEventListener("pagehide", () => stopSpeaking());
}

async function start(reply: WaitingReply, auto = true): Promise<void> {
  const mine: Playing = { key: reply.key, id: null };
  playing = mine;
  emit();
  const result: SpeakResult = await window.api.speech
    .speak({ text: reply.text, agentId: reply.agentId, auto })
    .catch(() => ({ skipped: "empty" as const }));
  if (playing !== mine) {
    if ("id" in result) void window.api.speech.stop(result.id);
    return;
  }
  if ("skipped" in result) {
    finish(true);
    return;
  }
  mine.id = result.id;
  const held = early.filter((e) => e.id === result.id);
  early = [];
  for (const event of held) enqueue(event);
}

/** Reads a reply aloud. One the person asked for stops whatever plays; one read by itself (`auto`)
 *  waits for the reading in course to end */
export async function speakReply(
  key: string,
  text: string,
  agentId: string,
  auto = false,
): Promise<void> {
  listen();
  const reply = { key, text, agentId };
  if (auto && playing) {
    if (playing.key !== key) waiting = addWaiting(waiting, reply);
    return;
  }
  stopSpeaking();
  await start(reply, auto);
}

export function stopSpeaking(): void {
  const was = playing;
  if (!was) return;
  finish();
  if (was.id) void window.api.speech.stop(was.id);
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Whether this reply is the one being read: only its button re-renders on a change */
export function useSpeaking(key: string): boolean {
  return useSyncExternalStore(subscribe, () => playing?.key === key);
}
