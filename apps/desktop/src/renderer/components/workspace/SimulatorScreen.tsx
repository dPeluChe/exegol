import { SIM_STREAM_SCALE, type SimScreenSize, type SimStreamEvent } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { useRef, useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { usePaneFocusTarget } from "../../hooks/use-pane-focus-target";
import {
  deviceScale,
  orientPoints,
  pointsFromFrame,
  type Size,
} from "../../lib/simulator-geometry";
import { trpcInvoke } from "../../lib/trpc-client";
import { useAppStore } from "../../stores/app";
import { HIDE_DEBOUNCE_MS } from "../terminal/use-terminal-visibility";
import { useSimulatorInput } from "./use-simulator-input";

const STUCK_START_MS = 10_000;
const SCREEN_SIZE_RETRY_MS = 5_000;

type StreamState = SimStreamEvent["state"];

function RestartButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded border border-border bg-bg-secondary px-2 py-0.5 text-[10px] text-text-secondary hover:text-text-primary"
    >
      <RotateCw className="h-3 w-3" /> Restart
    </button>
  );
}

/** "Starting": offers a restart once AXe has had time to send a frame */
function StartingNotice({ onRestart }: { onRestart: () => void }) {
  const [stuck, setStuck] = useState(false);
  useMountEffect(() => {
    const timer = setTimeout(() => setStuck(true), STUCK_START_MS);
    return () => clearTimeout(timer);
  });
  return (
    <>
      <span className="text-[11px] text-text-secondary">Starting the live view...</span>
      {stuck && <RestartButton onClick={onRestart} />}
    </>
  );
}

/** The live view: frames drawn straight to the canvas (no React render per frame) */
export function SimulatorScreen({
  paneId,
  udid,
  deviceName,
}: {
  paneId: string;
  udid: string;
  deviceName: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statsRef = useRef<HTMLSpanElement>(null);
  const frameSize = useRef<Size>({ width: 0, height: 0 });
  const [stream, setStream] = useState<{ state: StreamState; reason?: string }>({
    state: "starting",
  });
  const [attempt, setAttempt] = useState(0);
  // null while the device's tree does not answer yet (just booted): asked again, not cached
  const { data: screen } = useQuery({
    queryKey: ["simulator", "screenSize", udid],
    queryFn: () => trpcInvoke<SimScreenSize | null>("simulator.screenSize", { udid }),
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: (q) => (q.state.data ? false : SCREEN_SIZE_RETRY_MS),
  });

  const screenPoints = (): Size | null => {
    const frame = frameSize.current;
    if (screen) return orientPoints(screen, frame);
    return frame.width ? pointsFromFrame(frame, SIM_STREAM_SCALE, deviceScale(deviceName)) : null;
  };
  const input = useSimulatorInput({ udid, boxRef, canvasRef, frameSize, screenPoints });
  usePaneFocusTarget(paneId, boxRef);

  useMountEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !box || !ctx) return;
    let disposed = false;
    let decoding = false;
    let pending: { jpeg: Uint8Array; capturedAt: number } | null = null;
    let frames = 0;
    let statsAt = performance.now();

    const draw = async (jpeg: Uint8Array, capturedAt: number): Promise<void> => {
      decoding = true;
      try {
        const bitmap = await createImageBitmap(
          new Blob([jpeg as BlobPart], { type: "image/jpeg" }),
        );
        if (disposed) return bitmap.close();
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          frameSize.current = { width: bitmap.width, height: bitmap.height };
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        if (import.meta.env.DEV && statsRef.current) {
          frames++;
          const now = performance.now();
          if (now - statsAt >= 1000) {
            const fps = Math.round((frames * 1000) / (now - statsAt));
            statsRef.current.textContent = `${fps} fps, ${Date.now() - capturedAt} ms`;
            frames = 0;
            statsAt = now;
          }
        }
      } catch {
        // A torn frame: the next one replaces it
      } finally {
        decoding = false;
        if (pending && !disposed) {
          const next = pending;
          pending = null;
          void draw(next.jpeg, next.capturedAt);
        }
      }
    };

    const offFrame = window.api.simulator.onFrame(paneId, (jpeg, capturedAt) => {
      if (decoding) pending = { jpeg, capturedAt };
      else void draw(jpeg, capturedAt);
    });
    const offState = window.api.simulator.onState((event) => {
      if (event.paneId !== paneId) return;
      setStream({ state: event.state, reason: event.state === "ended" ? event.reason : undefined });
    });
    void window.api.simulator.startStream(paneId, udid);

    // Hidden = scrolled away, window in the background, or the Dashboard over the workspace
    let onScreen = true;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const report = () => {
      clearTimeout(hideTimer);
      const visible =
        onScreen &&
        document.visibilityState === "visible" &&
        useAppStore.getState().activeView !== "dashboard";
      if (visible) window.api.simulator.setVisible(paneId, true);
      else
        hideTimer = setTimeout(
          () => window.api.simulator.setVisible(paneId, false),
          HIDE_DEBOUNCE_MS,
        );
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = !!entry?.isIntersecting;
        report();
      },
      { threshold: 0.01 },
    );
    observer.observe(box);
    document.addEventListener("visibilitychange", report);
    const offView = useAppStore.subscribe((s, prev) => {
      if (s.activeView !== prev.activeView) report();
    });

    return () => {
      disposed = true;
      offFrame();
      offState();
      offView();
      observer.disconnect();
      document.removeEventListener("visibilitychange", report);
      clearTimeout(hideTimer);
      window.api.simulator.stopStream(paneId);
    };
  });

  const restart = () => {
    setStream({ state: "starting" });
    setAttempt((n) => n + 1);
    window.api.simulator.stopStream(paneId);
    void window.api.simulator.startStream(paneId, udid);
  };

  return (
    <div
      ref={boxRef}
      role="application"
      aria-label="Simulator screen"
      tabIndex={-1}
      onKeyDown={input.onKeyDown}
      onPaste={input.onPaste}
      className="relative h-full w-full p-2 outline-none"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={input.onPointerDown}
        onPointerUp={input.onPointerUp}
        onPointerCancel={input.onPointerCancel}
        className="h-full w-full touch-none object-contain"
      />
      {stream.state !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg-primary/80 text-center">
          {stream.state === "starting" ? (
            <StartingNotice key={attempt} onRestart={restart} />
          ) : (
            <>
              <span className="text-[11px] text-text-secondary">
                {stream.state === "ended"
                  ? `Live view stopped: ${stream.reason}`
                  : "Live view paused while hidden"}
              </span>
              <RestartButton onClick={restart} />
            </>
          )}
        </div>
      )}
      {import.meta.env.DEV && (
        <span
          ref={statsRef}
          className="pointer-events-none absolute bottom-1 left-2 font-mono text-[9px] text-text-muted"
        />
      )}
    </div>
  );
}
