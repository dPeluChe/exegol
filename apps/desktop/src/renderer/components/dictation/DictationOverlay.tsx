import { formatChord } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Download, Loader2, Mic, MicOff, X } from "lucide-react";
import { type MouseEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useDictationStatus, useMicAction } from "../../hooks/use-trpc-dictation";
import { useModelAction, useModels } from "../../hooks/use-trpc-models";
import {
  currentAnalyser,
  dismissDictation,
  startDictation,
  stopDictation,
} from "../../lib/dictation/controller";
import { dictationChord } from "../../lib/dictation/shortcut";
import { IS_MAC } from "../../lib/keymap";
import { paneRoot } from "../../lib/pane-focus";
import { useDictationStore } from "../../stores/dictation";
import { formatBytes } from "../workspace/sections/resource-format";

const CARD_WIDTH = 340;

/** Buttons keep the focus where it was: the text goes to the pane that had it */
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** Centered over the pane the text goes to (the window when there is none) while dictating */
export function DictationOverlay() {
  const phase = useDictationStore((s) => s.phase);
  const anchorPaneId = useDictationStore((s) => s.anchorPaneId);
  if (phase === "idle") return null;
  return <Positioned key={anchorPaneId ?? "window"} paneId={anchorPaneId} />;
}

function Positioned({ paneId }: { paneId: string | null }) {
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = paneId ? paneRoot(paneId) : null;
    const place = () => {
      const r = el?.getBoundingClientRect() ?? {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const left = Math.max(8, r.left + r.width / 2 - CARD_WIDTH / 2);
      setBox({
        left: Math.min(left, window.innerWidth - CARD_WIDTH - 8),
        top: r.top + r.height / 2,
      });
    };
    place();
    // A split dragged or the sidebar toggled moves the pane without a window resize
    const observer = new ResizeObserver(place);
    if (el) observer.observe(el);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [paneId]);
  if (!box) return null;
  return (
    <div
      className="fixed z-[220] -translate-y-1/2"
      style={{ left: box.left, top: box.top, width: CARD_WIDTH }}
      role="dialog"
      aria-label="Voice dictation"
    >
      <div className="overflow-hidden rounded-2xl border border-border bg-bg-secondary/95 shadow-2xl backdrop-blur">
        <Body />
      </div>
    </div>
  );
}

function Body() {
  const phase = useDictationStore((s) => s.phase);
  if (phase === "no-model") return <NoModel />;
  if (phase === "mic-denied") return <MicDenied />;
  if (phase === "error") return <ErrorBody />;
  return <Listening />;
}

function Listening() {
  const phase = useDictationStore((s) => s.phase);
  const partial = useDictationStore((s) => s.partial);
  const modelLoading = useDictationStore((s) => s.modelLoading);
  const streaming = useDictationStatus().data?.model.kind === "streaming";
  const listening = phase === "listening";
  const chord = dictationChord();
  const label =
    phase === "starting"
      ? "Starting"
      : phase === "transcribing"
        ? "Transcribing"
        : modelLoading
          ? "Listening (loading model)"
          : "Listening";
  return (
    <div className="p-3">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            listening ? "bg-error/15 text-error" : "bg-accent/15 text-accent",
          )}
        >
          {listening && <span className="absolute inset-0 animate-ping rounded-full bg-error/20" />}
          {listening ? <Mic className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
        </span>
        {listening ? <Waveform /> : <div className="h-8 min-w-0 flex-1" />}
        {phase === "listening" ? <Timer /> : <span className="w-10" />}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="font-medium text-text-secondary">{label}</span>
        <span className="text-text-muted">
          Esc cancels{chord && listening ? ` · ${formatChord(chord, IS_MAC)} inserts` : ""}
        </span>
      </div>
      {streaming && partial && (
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-text-primary">{partial}</p>
      )}
      {listening && (
        <div className="mt-2 flex justify-end gap-2">
          <OverlayButton onClick={dismissDictation}>Cancel</OverlayButton>
          <OverlayButton primary onClick={() => void stopDictation()}>
            Insert
          </OverlayButton>
        </div>
      )}
    </div>
  );
}

function Timer() {
  const startedAt = useDictationStore((s) => s.startedAt);
  const [now, setNow] = useState(Date.now());
  useMountEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  });
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <span className="w-10 text-right font-mono text-xs tabular-nums text-text-secondary">
      {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
    </span>
  );
}

const BARS = 32;

/** Mounted only while listening: the animation frame loop stops with it */
function Waveform() {
  const ref = useRef<HTMLCanvasElement>(null);
  useMountEffect(() => {
    let frame = 0;
    const data = new Uint8Array(1024);
    const color = ref.current ? getComputedStyle(ref.current).color : "";
    const draw = () => {
      frame = requestAnimationFrame(draw);
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
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      const analyser = currentAnalyser();
      const step = Math.floor(data.length / BARS);
      if (analyser) analyser.getByteTimeDomainData(data);
      const gap = 2 * dpr;
      const barW = (w - gap * (BARS - 1)) / BARS;
      for (let i = 0; i < BARS; i++) {
        let peak = 0;
        if (analyser) {
          for (let j = i * step; j < (i + 1) * step; j++) {
            peak = Math.max(peak, Math.abs((data[j] ?? 128) - 128) / 128);
          }
        }
        const barH = Math.max(2 * dpr, Math.min(1, peak * 2.5) * h);
        ctx.fillRect(i * (barW + gap), (h - barH) / 2, barW, barH);
      }
    };
    draw();
    return () => cancelAnimationFrame(frame);
  });
  return <canvas ref={ref} className="h-8 min-w-0 flex-1 text-accent" />;
}

function NoModel() {
  const { data: status } = useDictationStatus();
  const { data: models } = useModels();
  const action = useModelAction();
  const target = status?.model;
  // Downloaded while the overlay is still open (Download pressed here): start dictating
  useMountEffect(() =>
    window.api.onModelProgress((event) => {
      const s = useDictationStore.getState();
      if (event.status.state !== "ready" || s.phase !== "no-model" || !s.downloadRequested) return;
      s.set({ downloadRequested: false });
      void startDictation();
    }),
  );
  const live = models?.find((m) => m.id === target?.id)?.status;
  if (!target) return null;
  const ready = live?.state === "ready";
  const busy =
    live?.state === "downloading" || live?.state === "verifying" || live?.state === "extracting";
  const percent =
    live?.state === "downloading" && live.totalBytes > 0
      ? Math.round((live.receivedBytes / live.totalBytes) * 100)
      : null;
  return (
    <Panel
      icon={<Download className="h-4 w-4" />}
      title={ready ? "Speech model ready" : "Dictation needs a speech model"}
    >
      <p className="text-xs text-text-muted">
        {target.name}, {formatBytes(target.sizeBytes)}. It runs on this machine: audio never leaves
        it.
      </p>
      {busy && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
          <div
            className={cn(
              "h-full bg-accent transition-[width]",
              percent === null && "animate-pulse",
            )}
            style={{ width: `${percent ?? 100}%` }}
          />
        </div>
      )}
      {live?.state === "failed" && <p className="mt-2 text-xs text-error">{live.error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <OverlayButton onClick={dismissDictation}>Close</OverlayButton>
        {ready ? (
          <OverlayButton primary onClick={() => void startDictation()}>
            Start dictating
          </OverlayButton>
        ) : (
          <OverlayButton
            primary
            disabled={busy || action.isPending}
            onClick={() => {
              useDictationStore.getState().set({ downloadRequested: true });
              action.mutate({ action: "download", id: target.id });
            }}
          >
            {busy ? `Downloading${percent === null ? "" : ` ${percent}%`}` : "Download"}
          </OverlayButton>
        )}
      </div>
    </Panel>
  );
}

function MicDenied() {
  const mic = useMicAction();
  return (
    <Panel icon={<MicOff className="h-4 w-4" />} title="Exegol cannot use the microphone">
      <p className="text-xs text-text-muted">
        {IS_MAC
          ? "Allow Exegol in System Settings > Privacy & Security > Microphone, then try again."
          : "The system refused the microphone. Check that one is connected and allowed."}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <OverlayButton onClick={dismissDictation}>Close</OverlayButton>
        {IS_MAC && (
          <OverlayButton primary onClick={() => mic.mutate("openMicSettings")}>
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
    <Panel icon={<X className="h-4 w-4" />} title="Dictation failed">
      <p className="text-xs text-text-muted">{error}</p>
      <div className="mt-3 flex justify-end">
        <OverlayButton onClick={dismissDictation}>Close</OverlayButton>
      </div>
    </Panel>
  );
}

function Panel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="p-3">
      <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-text-primary">
        <span className="text-accent">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function OverlayButton({
  primary,
  disabled,
  onClick,
  children,
}: {
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
        primary
          ? "bg-accent text-white hover:bg-accent-hover"
          : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}
