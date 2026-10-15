import { dictationSettingsOf, formatChord, type KeyChord } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ArrowDown, Crosshair, Loader2, Mic, Pause, Play } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type UIEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useProjects, useSettings } from "../../hooks/use-trpc";
import { useDictationStatus } from "../../hooks/use-trpc-dictation";
import { AUTO_INSERT_COUNTDOWN_MS } from "../../lib/dictation/auto-insert";
import {
  cancelAutoInsert,
  dismissDictation,
  stopDictation,
  togglePauseDictation,
} from "../../lib/dictation/controller";
import { OVERLAY_ATTR } from "../../lib/dictation/overlay-keys";
import {
  dockedPill,
  freeSpan,
  type OverlayBox,
  overlayMode,
  PILL_HEIGHT,
  paneOnScreen,
  sameBox,
} from "../../lib/dictation/overlay-position";
import { dictationChord } from "../../lib/dictation/shortcut";
import { insertHint, TARGET_KINDS, targetName } from "../../lib/dictation/target";
import { clippedAbove, shouldFollow, unannounced } from "../../lib/dictation/transcript-scroll";
import { appKeys, IS_MAC } from "../../lib/keymap";
import { paneRoot } from "../../lib/pane-focus";
import { useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import {
  type DictationPhase,
  isRecording,
  recordedMs,
  useDictationStore,
} from "../../stores/dictation";
import { useWorkspaceStore } from "../../stores/workspace";
import { AgentIcon } from "../common/AgentIcon";
import { Kbd } from "../common/Kbd";
import { LevelBars } from "./LevelBars";
import { ModelChooser } from "./ModelChooser";
import { ErrorBody, MicDenied } from "./overlay-panels";
import { keepFocus, OverlayButton } from "./overlay-ui";
import { cardBox, DRAG_HANDLE, useOverlayDrag } from "./use-overlay-drag";

const CARD_WIDTH = 360;
const CHOOSER_WIDTH = 420;
const PILL_MAX_WIDTH = 440;

/** Over the pane the text goes to (the window when there is none) while dictating; a pill in the
 *  title bar while that pane is off screen, or always with the Title bar setting */
export function DictationOverlay() {
  const phase = useDictationStore((s) => s.phase);
  const anchorPaneId = useDictationStore((s) => s.anchorPaneId);
  if (phase === "idle") return null;
  return <Positioned key={anchorPaneId ?? "window"} paneId={anchorPaneId} />;
}

/** The pill's box, measured from the marked title bar: its inset (traffic lights), its controls
 *  and the project name */
function dockBox(): OverlayBox {
  const bar = document.querySelector<HTMLElement>("[data-titlebar]");
  const r = bar?.getBoundingClientRect();
  if (!bar || !r) {
    const width = Math.min(PILL_MAX_WIDTH, window.innerWidth - 16);
    return { left: (window.innerWidth - width) / 2, top: 6, width, docked: true };
  }
  const controls = [...bar.querySelectorAll(".titlebar-no-drag")].map((el) =>
    el.getBoundingClientRect(),
  );
  const inset = r.left + (Number.parseFloat(getComputedStyle(bar).paddingLeft) || 0);
  const name = bar.querySelector("[data-titlebar-title]")?.getBoundingClientRect();
  const free = freeSpan(window.innerWidth, controls, inset);
  const pill = dockedPill(free, name && name.width > 0 ? name : null, PILL_MAX_WIDTH);
  return { ...pill, top: r.top + (r.height - PILL_HEIGHT) / 2, docked: true };
}

function Positioned({ paneId }: { paneId: string | null }) {
  const phase = useDictationStore((s) => s.phase);
  const position = dictationSettingsOf(useSettings().data?.dictation).overlayPosition;
  const activeView = useAppStore((s) => s.activeView);
  const workspaceSection = useAppStore((s) => s.workspaceSection);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const onScreen = useWorkspaceStore(
    (ws) => !!paneId && paneOnScreen({ activeView, workspaceSection, activeProjectId }, ws, paneId),
  );
  const paused = useDictationStore((s) => s.pausedAt !== null);
  const recording = isRecording(phase) || phase === "transcribing";
  const mode = overlayMode(position, !!paneId, onScreen, recording);
  const width = phase === "no-model" ? CHOOSER_WIDTH : CARD_WIDTH;
  const [box, setBox] = useState<OverlayBox | null>(null);
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const drag = useOverlayDrag({ mode, paneId, width, card, apply: setBox });
  const { fx, fy, live } = drag;
  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      frame = 0;
      const offset = live.current ?? { fx, fy };
      const next =
        mode === "dock" ? dockBox() : cardBox(mode, paneId, { width, el: card }, offset).box;
      setBox((prev) => (sameBox(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    // Rects only: whether the pane is on screen comes from the stores above. A split dragged or
    // the sidebar toggled moves the pane, a project rename resizes the title, with no resize event
    const observer = new ResizeObserver(schedule);
    const watched =
      mode === "dock"
        ? [...document.querySelectorAll("[data-titlebar], [data-titlebar-title]")]
        : mode === "pane" && paneId
          ? [paneRoot(paneId)]
          : [];
    for (const el of watched) if (el) observer.observe(el);
    // The card's own height (text growing) moves where it must be clamped
    if (card && mode !== "dock") observer.observe(card);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [mode, paneId, width, fx, fy, card, live]);
  if (!box) return null;
  const failed = phase === "error" || phase === "mic-denied";
  return (
    <div
      ref={setCard}
      {...{ [OVERLAY_ATTR]: "" }}
      {...(box.docked ? {} : drag.handlers)}
      className={cn(
        // no-drag: docked in the title bar, the window's drag region would take the clicks
        "titlebar-no-drag fixed z-[220] cursor-default select-none transition-[left,top,width,transform] duration-300 ease-out motion-reduce:transition-none",
        !box.docked && "-translate-y-1/2",
        drag.dragging && "cursor-grabbing transition-none [&_*]:cursor-grabbing",
      )}
      style={{ left: box.left, top: box.top, width: box.width }}
      role="dialog"
      aria-label="Voice dictation"
    >
      {box.docked ? (
        <DockedPill phase={phase} />
      ) : (
        <div
          className={cn(
            "overflow-hidden rounded-2xl border bg-bg-secondary/95 shadow-2xl backdrop-blur transition-[border-color,box-shadow] duration-300",
            failed ? "border-error/40" : "border-accent/40",
            phase === "listening" && !paused && "shadow-[0_8px_40px_-12px_var(--color-accent)]",
          )}
        >
          <Body onCenter={drag.reset} />
        </div>
      )}
    </div>
  );
}

/** `onCenter` is set while the card sits at a dragged spot */
function Body({ onCenter }: { onCenter?: () => void }) {
  const phase = useDictationStore((s) => s.phase);
  if (phase === "no-model") return <ModelChooser />;
  if (phase === "mic-denied") return <MicDenied />;
  if (phase === "error") return <ErrorBody />;
  return <Recorder onCenter={onCenter} />;
}

function Recorder({ onCenter }: { onCenter?: () => void }) {
  const phase = useDictationStore((s) => s.phase);
  const paused = useDictationStore((s) => s.pausedAt !== null);
  return (
    // A click on the card is a no-op: recording goes on and the pane keeps the focus
    // biome-ignore lint/a11y/noStaticElementInteractions: swallows focus changes only
    <div onMouseDown={keepFocus}>
      <div
        {...DRAG_HANDLE}
        title="Drag to move, double-click to put back"
        className="grid cursor-grab grid-cols-[1fr_auto_1fr] items-center gap-2 px-3.5 pt-3"
      >
        <span className="flex min-w-0 justify-start">
          <StatePill phase={phase} />
        </span>
        {onCenter ? (
          <OverlayButton variant="icon" title="Center" label="Center" onClick={onCenter}>
            <Crosshair className="h-3 w-3" />
          </OverlayButton>
        ) : (
          <span />
        )}
        <span className="flex min-w-0 justify-end">
          <TargetChip />
        </span>
      </div>
      <div className="px-3.5 pt-2.5">
        {phase === "listening" ? <LevelBars muted={paused} /> : <div className="h-10" />}
      </div>
      <Transcript phase={phase} />
      <AutoInsertCountdown />
      <InputNotice />
      <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-bg-primary/40 px-3.5 py-1.5">
        <CancelButton />
        <InputName />
        <span className="flex shrink-0 items-center gap-1.5">
          {phase === "listening" && <PauseButton paused={paused} />}
          {isRecording(phase) && <InsertButton />}
        </span>
      </div>
    </div>
  );
}

/** Docked: one row inside the title bar's height, so the tab bar below stays clear. The last
 *  words show at the end of the row */
function DockedPill({ phase }: { phase: DictationPhase }) {
  const partial = useDictationStore((s) => s.partial);
  const paused = useDictationStore((s) => s.pausedAt !== null);
  return (
    // A click on the pill is a no-op: the pane keeps the focus
    <div
      role="toolbar"
      aria-label="Dictation"
      onMouseDown={keepFocus}
      style={{ height: PILL_HEIGHT }}
      className={cn(
        "flex items-center gap-2 rounded-full border border-accent/40 bg-bg-secondary/95 pr-1 pl-2.5 shadow-lg backdrop-blur",
        phase === "listening" && !paused && "shadow-[0_4px_20px_-8px_var(--color-accent)]",
      )}
    >
      <Announcer />
      {phase === "listening" && paused ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-text-muted">
          <Pause className="h-3 w-3" />
          <Timer />
        </span>
      ) : phase === "listening" ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-error">
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-error/60 motion-safe:animate-ping" />
            <span className="relative h-2 w-2 rounded-full bg-error" />
          </span>
          <Timer />
        </span>
      ) : (
        <Loader2 className="h-3 w-3 shrink-0 text-accent motion-safe:animate-spin" />
      )}
      {/* End-aligned so the newest words stay in view and the oldest slide out on the left */}
      <span className="flex min-w-0 flex-1 justify-end overflow-hidden whitespace-nowrap text-[11px] text-text-secondary [mask-image:linear-gradient(to_right,transparent,#000_1.5rem)]">
        <span>
          {phase === "transcribing"
            ? "Transcribing…"
            : partial || (paused ? "Paused" : "Listening")}
        </span>
      </span>
      <AutoInsertCountdown compact />
      <Commands phase={phase} />
    </div>
  );
}

/** Auto insert's last seconds: a draining bar; a click keeps this dictation going */
function AutoInsertCountdown({ compact = false }: { compact?: boolean }) {
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

function StatePill({ phase }: { phase: DictationPhase }) {
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

function Timer() {
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

/** Reads each finished phrase out once, in the card and the pill alike */
function Announcer() {
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

function Transcript({ phase }: { phase: DictationPhase }) {
  const partial = useDictationStore((s) => s.partial);
  const streaming = useDictationStatus().data?.model.kind === "streaming";
  const waiting = phase === "listening" || phase === "transcribing";
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLParagraphElement>(null);
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
    return () => observer.disconnect();
  });
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    follow.current = shouldFollow(el);
    setDetached(!follow.current);
    setClipped(clippedAbove(el));
  };
  return (
    <div className="relative px-3.5 pt-2 pb-3">
      <Announcer />
      {/* Not focusable on purpose: the focus stays on the target pane (keepFocus), so wheel and
          the Latest button scroll it and the live region above reads it out */}
      <div
        ref={box}
        onScroll={onScroll}
        className={cn(
          "sidebar-scroll max-h-[min(7.25rem,28vh)] overflow-y-auto overscroll-contain",
          clipped && "[mask-image:linear-gradient(to_bottom,transparent,#000_1.5rem)]",
        )}
      >
        <p
          ref={text}
          className={cn(
            "min-h-[2.75rem] text-sm leading-snug break-words whitespace-pre-wrap",
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

const MAC_GLYPHS: Record<string, string> = { Cmd: "⌘", Ctrl: "⌃", Shift: "⇧", Option: "⌥" };

/** The chord's keys for this platform: glyphs on macOS, words elsewhere */
const chordKeys = (chord: KeyChord): string[] =>
  formatChord(chord, IS_MAC)
    .split("+")
    .map((k) => (IS_MAC ? (MAC_GLYPHS[k] ?? k) : k));

/** The pill's keycaps that also click: Insert (accent) and Esc cancel (neutral) */
function Commands({ phase }: { phase: DictationPhase }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {isRecording(phase) && <InsertButton compact />}
      <CancelButton />
    </div>
  );
}

function InsertButton({ compact = false }: { compact?: boolean }) {
  const chord = dictationChord();
  const keys = chord && !compact ? chordKeys(chord) : [];
  const enter = IS_MAC ? "↵" : "Enter";
  return (
    <OverlayButton
      variant="insert"
      label={chord ? `Insert (Enter or ${formatChord(chord, IS_MAC)})` : "Insert (Enter)"}
      title={`Insert: ${[enter, chord ? chordKeys(chord).join("") : ""].filter(Boolean).join(" or ")}`}
      onClick={() => void stopDictation("button")}
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
  );
}

/** Pause the recording and pick it up again: same session, same text so far */
function PauseButton({ paused }: { paused: boolean }) {
  const keys = appKeys("Cmd+P");
  const word = paused ? "Resume" : "Pause";
  return (
    <OverlayButton
      variant="cancel"
      label={`${word} (${keys})`}
      title={`${word}: ${keys}`}
      onClick={togglePauseDictation}
    >
      {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
      <span>{paused ? "resume" : "pause"}</span>
    </OverlayButton>
  );
}

/** The mic this dictation opened */
function InputName() {
  const name = useDictationStore((s) => s.inputName);
  if (!name) return <span className="flex-1" />;
  return (
    <span
      title={`Input: ${name}`}
      className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 text-[10px] text-text-muted"
    >
      <Mic className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}

function InputNotice() {
  const notice = useDictationStore((s) => s.inputNotice);
  if (!notice) return null;
  return <p className="truncate px-3.5 pb-1.5 text-[10px] text-warning">{notice}</p>;
}

const CancelButton = () => (
  <OverlayButton
    variant="cancel"
    label="Cancel (Esc)"
    title="Cancel: Esc"
    onClick={() => dismissDictation("button")}
  >
    <KeyCap>Esc</KeyCap>
    <span>cancel</span>
  </OverlayButton>
);

const KeyCap = ({ children }: { children: ReactNode }) => (
  <Kbd className="h-5 min-w-5 px-1">{children}</Kbd>
);
