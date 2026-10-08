import { dictationSettingsOf, formatChord, type KeyChord } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { AlertTriangle, ArrowDown, Loader2, MicOff } from "lucide-react";
import { type ReactNode, type UIEvent, useLayoutEffect, useRef, useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useProjects, useSettings } from "../../hooks/use-trpc";
import { useDictationStatus, useMicAction } from "../../hooks/use-trpc-dictation";
import { currentAnalyser, dismissDictation, stopDictation } from "../../lib/dictation/controller";
import { OVERLAY_ATTR } from "../../lib/dictation/overlay-keys";
import {
  freeSpan,
  type OverlayBox,
  overlayBox,
  type Rect,
  sameBox,
} from "../../lib/dictation/overlay-position";
import { dictationChord } from "../../lib/dictation/shortcut";
import { insertHint, TARGET_KINDS, targetName } from "../../lib/dictation/target";
import {
  clippedAbove,
  shouldFollow,
  unannounced,
  wordCount,
} from "../../lib/dictation/transcript-scroll";
import { IS_MAC } from "../../lib/keymap";
import { paneRoot } from "../../lib/pane-focus";
import { useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { type DictationPhase, isRecording, useDictationStore } from "../../stores/dictation";
import { useWorkspaceStore } from "../../stores/workspace";
import { AgentIcon } from "../common/AgentIcon";
import { Kbd } from "../common/Kbd";
import { ModelChooser } from "./ModelChooser";
import { keepFocus, OverlayButton } from "./overlay-ui";

const CARD_WIDTH = 360;
const DOCKED_WIDTH = 400;
const CHOOSER_WIDTH = 420;
const TRAFFIC_LIGHTS_WIDTH = 80;
/** Re-checks whether the pane is still on screen: a section switch hides it with no store change */
const RECHECK_MS = 400;

/** Over the pane the text goes to (the window when there is none) while dictating; docked at
 *  the top center when that pane is off screen or the setting says so */
export function DictationOverlay() {
  const phase = useDictationStore((s) => s.phase);
  const anchorPaneId = useDictationStore((s) => s.anchorPaneId);
  if (phase === "idle") return null;
  return <Positioned key={anchorPaneId ?? "window"} paneId={anchorPaneId} />;
}

/** The pane's rect if some of it is on screen and not under another view (the dashboard covers
 *  mounted panes; a hidden tab or project has no size) */
function shownRect(el: Element | null): Rect | null {
  if (!el?.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  for (const [fx, fy] of [
    [0.5, 0.5],
    [0.2, 0.2],
    [0.8, 0.8],
  ] as const) {
    const x = r.left + r.width * fx;
    const y = r.top + r.height * fy;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
    const hit = document.elementsFromPoint(x, y).find((n) => !n.closest(`[${OVERLAY_ATTR}]`));
    if (hit && el.contains(hit)) return r;
  }
  return null;
}

/** What the title bar leaves free, read from its no-drag controls so its markup stays its own */
function titleBarSpan(): { left: number; right: number } {
  const bar = document.querySelector(".titlebar-drag");
  const controls = bar
    ? [...bar.querySelectorAll(".titlebar-no-drag")].map((el) => el.getBoundingClientRect())
    : [];
  return freeSpan(window.innerWidth, controls, IS_MAC ? TRAFFIC_LIGHTS_WIDTH : 0);
}

function Positioned({ paneId }: { paneId: string | null }) {
  const phase = useDictationStore((s) => s.phase);
  const position = dictationSettingsOf(useSettings().data?.dictation).overlayPosition;
  const [box, setBox] = useState<OverlayBox | null>(null);
  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      frame = 0;
      // Looked up each time: the pane remounts on a project switch
      const el = paneId ? paneRoot(paneId) : null;
      const shown = position === "pane" ? shownRect(el) : null;
      const docked = position === "titlebar" || (!!paneId && !shown);
      const width = phase === "no-model" ? CHOOSER_WIDTH : docked ? DOCKED_WIDTH : CARD_WIDTH;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const next = overlayBox(position, !!paneId, shown, viewport, width, titleBarSpan);
      setBox((prev) => (sameBox(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    // A split dragged or the sidebar toggled moves the pane without a window resize
    const observer = new ResizeObserver(schedule);
    const el = paneId ? paneRoot(paneId) : null;
    if (el) observer.observe(el);
    window.addEventListener("resize", schedule);
    const offApp = useAppStore.subscribe(schedule);
    const offWorkspace = useWorkspaceStore.subscribe(schedule);
    const timer = setInterval(schedule, RECHECK_MS);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      offApp();
      offWorkspace();
      clearInterval(timer);
    };
  }, [paneId, position, phase]);
  if (!box) return null;
  const failed = phase === "error" || phase === "mic-denied";
  return (
    <div
      {...{ [OVERLAY_ATTR]: "" }}
      className={cn(
        // no-drag: docked over the title bar, the window's drag region would take the clicks
        "titlebar-no-drag fixed z-[220] cursor-default select-none transition-[left,top,width,transform] duration-300 ease-out motion-reduce:transition-none",
        !box.docked && "-translate-y-1/2",
      )}
      style={{ left: box.left, top: box.top, width: box.width }}
      role="dialog"
      aria-label="Voice dictation"
    >
      <div
        className={cn(
          "overflow-hidden rounded-2xl border bg-bg-secondary/95 shadow-2xl backdrop-blur transition-[border-color,box-shadow] duration-300",
          failed ? "border-error/40" : "border-accent/40",
          phase === "listening" && "shadow-[0_8px_40px_-12px_var(--color-accent)]",
        )}
      >
        <Body compact={box.docked} />
      </div>
    </div>
  );
}

function Body({ compact }: { compact: boolean }) {
  const phase = useDictationStore((s) => s.phase);
  if (phase === "no-model") return <ModelChooser />;
  if (phase === "mic-denied") return <MicDenied />;
  if (phase === "error") return <ErrorBody />;
  return <Recorder compact={compact} />;
}

/** Compact when docked at the top: no level bars, a shorter transcript */
function Recorder({ compact }: { compact: boolean }) {
  const phase = useDictationStore((s) => s.phase);
  return (
    // A click on the card is a no-op: recording goes on and the pane keeps the focus
    // biome-ignore lint/a11y/noStaticElementInteractions: swallows focus changes only
    <div onMouseDown={keepFocus}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3.5 pt-3">
        <StatePill phase={phase} />
        <Commands phase={phase} />
      </div>
      {!compact && (
        <div className="px-3.5 pt-2.5">
          {phase === "listening" ? <LevelBars /> : <div className="h-10" />}
        </div>
      )}
      <Transcript phase={phase} compact={compact} />
      <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-bg-primary/40 px-3.5 py-1.5">
        <TargetChip />
        <WordCount />
      </div>
    </div>
  );
}

function StatePill({ phase }: { phase: DictationPhase }) {
  const modelLoading = useDictationStore((s) => s.modelLoading);
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
      {phase === "transcribing" ? "Finishing" : "Starting"}
    </span>
  );
}

function Timer() {
  const startedAt = useDictationStore((s) => s.startedAt);
  const [now, setNow] = useState(Date.now());
  // Ticks on each whole second of the recording, not on a fixed poll
  useMountEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      id = setTimeout(tick, 1000 - ((t - startedAt) % 1000) + 5);
    };
    tick();
    return () => clearTimeout(id);
  });
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <span className="font-mono tabular-nums">
      {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
    </span>
  );
}

/** Where Insert puts the text: the session (its CLI's icon and alias) and its project */
function TargetChip() {
  const kind = useDictationStore((s) => s.targetKind);
  const agentId = useDictationStore((s) => s.targetAgentId);
  const projectId = useDictationStore((s) => s.targetProjectId);
  const agent = useAgentStore((s) => (agentId ? s.agents[agentId] : undefined));
  const { data: projects } = useProjects();
  const project = projects?.find((p) => p.id === projectId)?.name;
  const pressEnter = dictationSettingsOf(useSettings().data?.dictation).pressEnter;
  const Icon = kind === "terminal" ? null : TARGET_KINDS[kind].icon;
  const name = targetName(kind, agent);
  return (
    <span
      title={insertHint(kind, name, pressEnter)}
      className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border/70 bg-bg-tertiary/60 py-0.5 pr-2.5 pl-1 text-[11px] text-text-secondary"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-primary/70">
        {Icon ? (
          <Icon className="h-3 w-3 text-text-muted" />
        ) : (
          <AgentIcon provider={agent?.cliType ?? "shell"} size={12} />
        )}
      </span>
      <span className="truncate font-medium text-text-primary">{name}</span>
      {project && <span className="truncate text-text-muted">{project}</span>}
      {kind === "terminal" && pressEnter && <span className="shrink-0 text-accent">+ Enter</span>}
    </span>
  );
}

/** Pauses this long close a phrase for screen readers: streamed words are not read one by one */
const ANNOUNCE_AFTER_MS = 1200;

function Transcript({ phase, compact }: { phase: DictationPhase; compact: boolean }) {
  const partial = useDictationStore((s) => s.partial);
  const streaming = useDictationStatus().data?.model.kind === "streaming";
  const waiting = phase === "listening" || phase === "transcribing";
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLParagraphElement>(null);
  const live = useRef<HTMLSpanElement>(null);
  const follow = useRef(true);
  const [clipped, setClipped] = useState(false);
  const [detached, setDetached] = useState(false);
  const toEnd = () => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  useMountEffect(() => {
    // Text grows with no scroll event, and a window resize rewraps it: both re-pin the end
    const observer = new ResizeObserver(() => {
      if (follow.current) toEnd();
    });
    if (text.current) observer.observe(text.current);
    if (box.current) observer.observe(box.current);
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
      observer.disconnect();
      unsubscribe();
      clearTimeout(timer);
    };
  });
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    follow.current = shouldFollow(el);
    setDetached(!follow.current);
    setClipped(clippedAbove(el));
  };
  return (
    <div className="relative px-3.5 pt-2 pb-3">
      <span ref={live} aria-live="polite" className="sr-only" />
      {/* Not focusable on purpose: the focus stays on the target pane (keepFocus), so wheel and
          the Latest button scroll it and the live region above reads it out */}
      <div
        ref={box}
        onScroll={onScroll}
        className={cn(
          "sidebar-scroll overflow-y-auto overscroll-contain",
          compact ? "max-h-[3.6rem]" : "max-h-[min(7.25rem,28vh)]",
          clipped && "[mask-image:linear-gradient(to_bottom,transparent,#000_1.5rem)]",
        )}
      >
        <p
          ref={text}
          className={cn(
            "text-sm leading-snug break-words whitespace-pre-wrap",
            compact ? "min-h-[1.25rem]" : "min-h-[2.75rem]",
            partial ? "text-text-primary" : "text-text-muted",
          )}
        >
          {partial ||
            (phase === "transcribing"
              ? "Writing down the last words"
              : streaming
                ? "Speak, the text appears as you go"
                : "Speak, each phrase appears when you pause")}
          {waiting && (
            <span
              aria-hidden
              className={cn(
                "ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] rounded-full bg-accent/80",
                phase === "transcribing" ? "motion-safe:animate-pulse" : "animate-caret",
              )}
            />
          )}
        </p>
      </div>
      {detached && (
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={toEnd}
          className="absolute right-4 bottom-2 inline-flex items-center gap-1 rounded-full border border-border/70 bg-bg-secondary px-2 py-0.5 text-[10px] text-text-secondary shadow-md hover:text-text-primary"
        >
          <ArrowDown className="h-3 w-3" />
          Latest
        </button>
      )}
    </div>
  );
}

function WordCount() {
  const words = useDictationStore((s) => wordCount(s.partial));
  if (!words) return null;
  return (
    <span className="shrink-0 text-[10px] tabular-nums text-text-muted">
      {words} {words === 1 ? "word" : "words"}
    </span>
  );
}

const MAC_GLYPHS: Record<string, string> = { Cmd: "⌘", Ctrl: "⌃", Shift: "⇧", Option: "⌥" };

/** The chord's keys for this platform: glyphs on macOS, words elsewhere */
const chordKeys = (chord: KeyChord): string[] =>
  formatChord(chord, IS_MAC)
    .split("+")
    .map((k) => (IS_MAC ? (MAC_GLYPHS[k] ?? k) : k));

/** Keycaps that also click: Insert (Enter or the dictation chord) and Esc cancel */
function Commands({ phase }: { phase: DictationPhase }) {
  const chord = dictationChord();
  const keys = chord ? chordKeys(chord) : [];
  const enter = IS_MAC ? "↵" : "Enter";
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {isRecording(phase) && (
        <OverlayButton
          variant="keys"
          label={chord ? `Insert (Enter or ${formatChord(chord, IS_MAC)})` : "Insert (Enter)"}
          title={`Insert: ${[enter, keys.join("")].filter(Boolean).join(" or ")}`}
          onClick={() => void stopDictation()}
        >
          <KeyCap>{enter}</KeyCap>
          {keys.length > 0 && (
            <>
              <span>or</span>
              <span className="inline-flex gap-0.5">
                {keys.map((k) => (
                  <KeyCap key={k}>{k}</KeyCap>
                ))}
              </span>
            </>
          )}
          <span>insert</span>
        </OverlayButton>
      )}
      <OverlayButton
        variant="keys"
        label="Cancel (Esc)"
        title="Cancel: Esc"
        onClick={dismissDictation}
      >
        <KeyCap>Esc</KeyCap>
        <span>cancel</span>
      </OverlayButton>
    </div>
  );
}

const KeyCap = ({ children }: { children: ReactNode }) => (
  <Kbd className="h-5 min-w-5 px-1">{children}</Kbd>
);

const BARS = 28;

/** Mounted only while listening: the draw loop stops with it. Each bar is the level of a slice
 *  of the last audio frame, held and eased down so speech reads as motion */
function LevelBars() {
  const ref = useRef<HTMLCanvasElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  useMountEffect(() => {
    let frame = 0;
    let glowShown = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const data = new Uint8Array(1024);
    const levels = new Float32Array(BARS);
    const color = ref.current ? getComputedStyle(ref.current).color : "";
    // Reduced motion: a few still frames a second, no easing or glow
    const next = () => {
      frame = reduce ? window.setTimeout(draw, 200) : requestAnimationFrame(draw);
    };
    const draw = () => {
      next();
      const canvas = ref.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const analyser = currentAnalyser();
      if (analyser) analyser.getByteTimeDomainData(data);
      const step = Math.floor(data.length / BARS);
      let total = 0;
      for (let i = 0; i < BARS; i++) {
        let sum = 0;
        for (let j = i * step; j < (i + 1) * step; j++) {
          const v = analyser ? ((data[j] ?? 128) - 128) / 128 : 0;
          sum += v * v;
        }
        // Speech RMS sits around 0.02-0.2: scaled so a normal voice fills most of the height
        const level = Math.min(1, Math.sqrt(sum / step) * 6);
        levels[i] = reduce ? level : Math.max(level, (levels[i] ?? 0) * 0.86);
        total += levels[i] ?? 0;
      }
      // Only real moves restyle the blurred layer
      const glowLevel = reduce ? 0 : Math.min(1, (total / BARS) * 2);
      if (glow.current && Math.abs(glowLevel - glowShown) > 0.05) {
        glowShown = glowLevel;
        glow.current.style.opacity = glowLevel.toFixed(2);
      }
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      const gap = 3 * dpr;
      const barW = (w - gap * (BARS - 1)) / BARS;
      const min = 3 * dpr;
      for (let i = 0; i < BARS; i++) {
        // Taller in the middle: reads as a voice, not a meter
        const shape = 0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / BARS);
        const level = levels[i] ?? 0;
        const barH = Math.max(min, level * shape * h);
        ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, level * 1.5);
        ctx.beginPath();
        ctx.roundRect(i * (barW + gap), (h - barH) / 2, barW, barH, barW / 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    next();
    return () => {
      if (reduce) clearTimeout(frame);
      else cancelAnimationFrame(frame);
    };
  });
  return (
    <div className="relative h-10">
      <div
        ref={glow}
        aria-hidden
        className="pointer-events-none absolute inset-x-6 inset-y-1 rounded-full bg-accent/25 opacity-0 blur-xl"
      />
      <canvas
        ref={ref}
        aria-hidden
        className="pointer-events-none relative h-10 w-full text-accent"
      />
    </div>
  );
}

function MicDenied() {
  const mic = useMicAction();
  return (
    <Panel icon={<MicOff className="h-4 w-4" />} title="Exegol cannot use the microphone">
      <p className="text-xs leading-relaxed text-text-secondary">
        {IS_MAC
          ? "Allow Exegol in System Settings > Privacy & Security > Microphone, then try again."
          : "The system refused the microphone. Check that one is connected and allowed."}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <OverlayButton onClick={dismissDictation}>Close</OverlayButton>
        {IS_MAC && (
          <OverlayButton variant="primary" onClick={() => mic.mutate("openMicSettings")}>
            Open System Settings
          </OverlayButton>
        )}
      </div>
    </Panel>
  );
}

function ErrorBody() {
  const error = useDictationStore((s) => s.error);
  return (
    <Panel icon={<AlertTriangle className="h-4 w-4" />} title="Dictation failed">
      <p className="text-xs leading-relaxed break-words text-text-secondary">{error}</p>
      <div className="mt-3 flex justify-end">
        <OverlayButton onClick={dismissDictation}>Close</OverlayButton>
      </div>
    </Panel>
  );
}

function Panel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 p-3.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-error/10 text-error">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-sm font-medium text-text-primary">{title}</div>
        {children}
      </div>
    </div>
  );
}
