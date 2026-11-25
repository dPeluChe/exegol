import { cn } from "@exegol/ui";
import { Loader2, Pause } from "lucide-react";
import { type CSSProperties, useRef, useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { AUTO_INSERT_COUNTDOWN_MS } from "../../lib/dictation/auto-insert";
import { cancelAutoInsert } from "../../lib/dictation/controller";
import { unannounced } from "../../lib/dictation/transcript-scroll";
import { type DictationPhase, recordedMs, useDictationStore } from "../../stores/dictation";
import { keepFocus } from "./overlay-ui";

/** Auto insert's last seconds: a draining bar; a click keeps this dictation going */
export function AutoInsertCountdown({ compact = false }: { compact?: boolean }) {
  const countdown = useDictationStore((s) => s.autoInsertCountdown);
  if (!countdown) return null;
  return <Countdown key={countdown.endsAt} {...countdown} compact={compact} />;
}

function Countdown({ endsAt, ms, compact }: { endsAt: number; ms: number; compact: boolean }) {
  const [secs, setSecs] = useState(Math.ceil(ms / 1000));
  // The label changes once a second; the bar drains on its own (CSS)
  useMountEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      const left = endsAt - Date.now();
      setSecs(Math.max(0, Math.ceil(left / 1000)));
      if (left > 0) id = setTimeout(tick, (left % 1000 || 1000) + 5);
    };
    tick();
    return () => clearTimeout(id);
  });
  const drain = {
    "--from": Math.max(0, Math.min(1, ms / AUTO_INSERT_COUNTDOWN_MS)),
    animationDuration: `${ms}ms`,
  } as CSSProperties;
  return (
    <button
      type="button"
      onMouseDown={keepFocus}
      onClick={cancelAutoInsert}
      title="Click to keep dictating: no auto insert this time"
      className={cn(
        "shrink-0 text-left text-[11px] font-medium text-accent",
        compact
          ? "flex w-24 flex-col gap-0.5 rounded-md px-1.5 py-0.5 hover:bg-accent/10"
          : "mx-3.5 mb-2 flex w-[calc(100%-1.75rem)] flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-accent/10",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span aria-live="polite">Inserting in {secs}…</span>
        {!compact && <span className="font-normal text-text-muted">Click to keep dictating</span>}
      </span>
      <span className="block h-1 overflow-hidden rounded-full bg-accent/15">
        <span
          className="animate-countdown-drain block h-full rounded-full bg-accent"
          style={drain}
        />
      </span>
    </button>
  );
}

export function StatePill({ phase }: { phase: DictationPhase }) {
  const modelLoading = useDictationStore((s) => s.modelLoading);
  const paused = useDictationStore((s) => s.pausedAt !== null);
  if (phase === "listening" && paused) {
    return (
      <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-bg-tertiary/80 py-1 pr-2.5 pl-2 text-[11px] font-medium text-text-secondary">
        <Pause className="h-3 w-3" />
        <Timer />
        <span className="font-normal text-text-muted">Paused</span>
      </span>
    );
  }
  if (phase === "listening") {
    return (
      <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-error/10 py-1 pr-2.5 pl-2 text-[11px] font-medium text-error">
        <span className="relative flex h-2 w-2">
          <span className="absolute inset-0 rounded-full bg-error/60 motion-safe:animate-ping" />
          <span className="relative h-2 w-2 rounded-full bg-error" />
        </span>
        <Timer />
        <span className="font-normal text-text-secondary">
          {modelLoading ? "Loading model" : "Listening"}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent/10 py-1 pr-2.5 pl-2 text-[11px] font-medium text-accent">
      <Loader2 className="h-3 w-3 motion-safe:animate-spin" />
      {phase === "transcribing" ? "Transcribing…" : "Starting"}
    </span>
  );
}

export function Timer() {
  const startedAt = useDictationStore((s) => s.startedAt);
  const pausedAt = useDictationStore((s) => s.pausedAt);
  const [now, setNow] = useState(Date.now());
  // Ticks on each whole second of the recording, not on a fixed poll; a resume moves startedAt
  useMountEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const ms = recordedMs(useDictationStore.getState(), t);
      id = setTimeout(tick, 1000 - (ms % 1000) + 5);
    };
    tick();
    return () => clearTimeout(id);
  });
  const secs = Math.floor(recordedMs({ startedAt, pausedAt }, now) / 1000);
  return (
    <span className="font-mono tabular-nums">
      {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
    </span>
  );
}

/** Pauses this long close a phrase for screen readers: streamed words are not read one by one */
const ANNOUNCE_AFTER_MS = 1200;

/** Reads each finished phrase out once, in the card and the pill alike */
export function Announcer() {
  const live = useRef<HTMLSpanElement>(null);
  useMountEffect(() => {
    let announced = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useDictationStore.subscribe((s, prev) => {
      if (s.partial === prev.partial) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = unannounced(announced, s.partial);
        announced = s.partial;
        if (live.current && next) live.current.textContent = next;
      }, ANNOUNCE_AFTER_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  });
  return <span ref={live} aria-live="polite" className="sr-only" />;
}
