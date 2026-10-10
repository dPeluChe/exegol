import {
  AXE_INSTALL_COMMAND,
  SIM_KEYCODES,
  type SimDevice,
  type SimKey,
  type SimScreenSize,
  type SimStreamEvent,
} from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Download, ExternalLink, Home, Power, RotateCw, Smartphone } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useSimDevices, useSimulatorSupport } from "../../hooks/use-simulator";
import { claimPaneFocus } from "../../lib/pane-focus";
import {
  clampToScreen,
  isTap,
  pointsFromFrame,
  type Rect,
  type Size,
  swipeSeconds,
  toDevicePoint,
  typeable,
} from "../../lib/simulator-geometry";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { toastError, useToastStore } from "../../stores/toasts";
import { type Pane, useWorkspaceStore } from "../../stores/workspace";
import { LoadingSpinner } from "../common";
import { CopyCommand } from "../common/CopyCommand";

const isMac = () => (window.api?.app?.getPlatform?.() ?? "darwin") === "darwin";
const isSimKey = (key: string): key is SimKey => Object.hasOwn(SIM_KEYCODES, key);

/** A booted iOS device first, else the first iPhone */
function defaultDevice(devices: SimDevice[]): SimDevice | undefined {
  return (
    devices.find((d) => d.state === "Booted" && d.runtime.startsWith("iOS")) ??
    devices.find((d) => d.name.startsWith("iPhone")) ??
    devices[0]
  );
}

function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
      <Smartphone className="h-7 w-7 text-text-muted" />
      <div className="text-xs font-medium text-text-primary">{title}</div>
      {children}
    </div>
  );
}

export function SimulatorPane({ pane, paneId }: { pane: Pane; paneId: string }) {
  const support = useSimulatorSupport();
  if (!isMac()) return <Notice title="The Simulator pane needs macOS" />;
  if (support.isLoading) return <LoadingSpinner label="Looking for Xcode..." className="h-full" />;
  if (!support.data?.simctl) {
    return (
      <Notice title="Xcode's simulator tools were not found">
        <p className="max-w-xs text-[11px] text-text-muted">
          Install Xcode, then select it for the command line tools:
        </p>
        <div className="w-full max-w-xs">
          <CopyCommand
            label="Select Xcode"
            command="sudo xcode-select -s /Applications/Xcode.app"
          />
        </div>
      </Notice>
    );
  }
  return <SimulatorView pane={pane} paneId={paneId} hasAxe={!!support.data.axe} />;
}

function AxeInstallCard() {
  const queryClient = useQueryClient();
  return (
    <Notice title="AXe is needed to see and drive the simulator">
      <p className="max-w-xs text-[11px] text-text-muted">
        AXe (MIT, by Cameron Cooke) streams the screen and sends taps and keys. Install it with
        Homebrew, then check again:
      </p>
      <div className="w-full max-w-xs">
        <CopyCommand label="Install" command={AXE_INSTALL_COMMAND} />
      </div>
      <button
        type="button"
        onClick={() => queryClient.invalidateQueries({ queryKey: ["simulator", "support"] })}
        className="mt-1 rounded border border-border bg-bg-secondary px-3 py-1 text-[10px] text-text-secondary hover:text-text-primary"
      >
        Check again
      </button>
    </Notice>
  );
}

function ToolButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function SimulatorView({ pane, paneId, hasAxe }: { pane: Pane; paneId: string; hasAxe: boolean }) {
  const queryClient = useQueryClient();
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const { data: devices = [], isLoading } = useSimDevices(true);
  const device = devices.find((d) => d.udid === pane.simUdid) ?? defaultDevice(devices);
  const udid = device?.udid;
  const booted = device?.state === "Booted";
  const refreshDevices = () =>
    queryClient.invalidateQueries({ queryKey: ["simulator", "devices"] });

  const power = useMutation({
    mutationFn: (action: "boot" | "shutdown") => {
      if (action === "boot" && udid) updatePane(paneId, { simUdid: udid });
      return trpcMutate(`simulator.${action}`, { udid });
    },
    onSettled: refreshDevices,
    onError: toastError("Simulator"),
  });
  const shot = useMutation({
    mutationFn: (to: "clipboard" | "file") =>
      trpcMutate<{ ok: boolean }>("simulator.screenshot", { udid, to }),
    onSuccess: (res, to) => {
      if (to === "clipboard" && res.ok)
        useToastStore.getState().addToast({ type: "success", title: "Screenshot copied" });
    },
    onError: toastError("Screenshot failed"),
  });
  const run = (path: string, input: object) =>
    trpcMutate(path, { udid, ...input }).catch(toastError("Simulator"));

  if (isLoading) return <LoadingSpinner label="Listing simulators..." className="h-full" />;
  if (!device || !udid) return <Notice title="No simulators: add one in Xcode > Devices" />;

  const starting = power.isPending || device.state === "Booting";
  let body: ReactNode;
  if (!booted) {
    body = (
      <Notice title={starting ? "Booting..." : `${device.name} is shut down`}>
        {!starting && (
          <button
            type="button"
            onClick={() => power.mutate("boot")}
            className="rounded bg-accent px-3 py-1 text-[11px] text-white hover:opacity-90"
          >
            Boot
          </button>
        )}
      </Notice>
    );
  } else if (!hasAxe) body = <AxeInstallCard />;
  else body = <SimulatorScreen key={udid} paneId={paneId} udid={udid} />;

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <select
          value={udid}
          onChange={(e) => updatePane(paneId, { simUdid: e.target.value })}
          aria-label="Simulator device"
          className="min-w-0 max-w-[14rem] flex-1 truncate rounded border border-border bg-bg-secondary px-1.5 py-0.5 text-[11px] text-text-primary outline-none"
        >
          {[...new Set(devices.map((d) => d.runtime))].map((runtime) => (
            <optgroup key={runtime} label={runtime}>
              {devices
                .filter((d) => d.runtime === runtime)
                .map((d) => (
                  <option key={d.udid} value={d.udid}>
                    {d.name}
                    {d.state === "Booted" ? " (booted)" : ""}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <span className="truncate text-[10px] text-text-muted">{device.state}</span>
        <div className="flex-1" />
        {booted && hasAxe && (
          <ToolButton title="Home" onClick={() => run("simulator.button", { button: "home" })}>
            <Home className="h-3.5 w-3.5" />
          </ToolButton>
        )}
        {booted && (
          <>
            <ToolButton
              title="Copy a screenshot"
              disabled={shot.isPending}
              onClick={() => shot.mutate("clipboard")}
            >
              <Camera className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton
              title="Save a screenshot..."
              disabled={shot.isPending}
              onClick={() => shot.mutate("file")}
            >
              <Download className="h-3.5 w-3.5" />
            </ToolButton>
          </>
        )}
        <ToolButton title="Open in Simulator.app" onClick={() => run("simulator.openApp", {})}>
          <ExternalLink className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          title={booted ? "Shut down" : "Boot"}
          disabled={starting || power.isPending}
          onClick={() => power.mutate(booted ? "shutdown" : "boot")}
        >
          <Power className={booted ? "h-3.5 w-3.5 text-success" : "h-3.5 w-3.5"} />
        </ToolButton>
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}

const HIDE_DEBOUNCE_MS = 1_500;
const TYPE_FLUSH_MS = 120;

type StreamState = SimStreamEvent["state"];

/** The live view: frames drawn straight to the canvas (no React render per frame) */
function SimulatorScreen({ paneId, udid }: { paneId: string; udid: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statsRef = useRef<HTMLSpanElement>(null);
  const frameSize = useRef<Size>({ width: 0, height: 0 });
  const [stream, setStream] = useState<{ state: StreamState; reason?: string }>({
    state: "starting",
  });
  const { data: screen } = useQuery({
    queryKey: ["simulator", "screenSize", udid],
    queryFn: () => trpcInvoke<SimScreenSize | null>("simulator.screenSize", { udid }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  useMountEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !box || !ctx) return;
    let disposed = false;
    let decoding = false;
    let pending: Uint8Array | null = null;
    let frames = 0;
    let latency = 0;
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
          latency = Date.now() - capturedAt;
          const now = performance.now();
          if (now - statsAt >= 1000) {
            statsRef.current.textContent = `${Math.round((frames * 1000) / (now - statsAt))} fps, ${latency} ms`;
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
          void draw(next, Date.now());
        }
      }
    };

    const offFrame = window.api.simulator.onFrame(paneId, (jpeg, capturedAt) => {
      if (decoding) pending = jpeg;
      else void draw(jpeg, capturedAt);
    });
    const offState = window.api.simulator.onState((event) => {
      if (event.paneId !== paneId) return;
      setStream({ state: event.state, reason: event.state === "ended" ? event.reason : undefined });
    });
    void window.api.simulator.startStream(paneId, udid);

    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        clearTimeout(hideTimer);
        if (entry?.isIntersecting) window.api.simulator.setVisible(paneId, true);
        else
          hideTimer = setTimeout(
            () => window.api.simulator.setVisible(paneId, false),
            HIDE_DEBOUNCE_MS,
          );
      },
      { threshold: 0.01 },
    );
    observer.observe(box);

    const onFocusPane = (e: Event) => {
      if ((e as CustomEvent<{ paneId?: string }>).detail?.paneId === paneId) box.focus();
    };
    window.addEventListener("exegol:focus-pane", onFocusPane);
    if (claimPaneFocus(paneId)) box.focus();

    return () => {
      disposed = true;
      offFrame();
      offState();
      observer.disconnect();
      clearTimeout(hideTimer);
      window.removeEventListener("exegol:focus-pane", onFocusPane);
      window.api.simulator.stopStream(paneId);
    };
  });

  // One input at a time, in order: a tap must not land before the text typed ahead of it
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const send = (path: string, input: object) => {
    queue.current = queue.current.then(() =>
      trpcMutate(path, { udid, ...input }).catch(toastError("Simulator input failed")),
    );
  };

  const typed = useRef("");
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushTyped = () => {
    clearTimeout(flushTimer.current);
    const text = typed.current;
    typed.current = "";
    if (text) send("simulator.type", { text });
  };
  const typeText = (text: string) => {
    typed.current += text;
    clearTimeout(flushTimer.current);
    if (typed.current.length >= 200) flushTyped();
    else flushTimer.current = setTimeout(flushTyped, TYPE_FLUSH_MS);
  };

  const screenPoints = (): Size | null => {
    if (screen) return screen;
    return frameSize.current.width ? pointsFromFrame(frameSize.current) : null;
  };
  const canvasBox = (): Rect | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
  };

  const press = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    boxRef.current?.focus();
    press.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const down = press.current;
    press.current = null;
    const box = canvasBox();
    const points = screenPoints();
    const frame = frameSize.current;
    if (!down || !box || !points || !frame.width) return;
    const up = { x: e.clientX, y: e.clientY };
    flushTyped();
    if (isTap(down, up)) {
      const at = toDevicePoint(up, box, frame, points);
      if (at) send("simulator.tap", at);
      return;
    }
    const from = toDevicePoint(down, box, frame, points);
    const to = toDevicePoint(clampToScreen(up, box, frame), box, frame, points);
    if (from && to)
      send("simulator.swipe", { from, to, durationS: swipeSeconds(performance.now() - down.t) });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isSimKey(e.key)) {
      e.preventDefault();
      flushTyped();
      send("simulator.key", { key: e.key });
    } else if (typeable(e.key)) {
      e.preventDefault();
      typeText(e.key);
    }
  };
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = [...e.clipboardData.getData("text")].filter(typeable).join("");
    if (!text) return;
    e.preventDefault();
    typeText(text);
  };

  return (
    <div
      ref={boxRef}
      role="application"
      aria-label="Simulator screen"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      className="relative h-full w-full p-2 outline-none"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          press.current = null;
        }}
        className="h-full w-full touch-none object-contain"
      />
      {stream.state !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg-primary/80 text-center">
          <span className="text-[11px] text-text-secondary">
            {stream.state === "ended"
              ? `Live view stopped: ${stream.reason}`
              : stream.state === "paused"
                ? "Live view paused while hidden"
                : "Starting the live view..."}
          </span>
          {stream.state !== "starting" && (
            <button
              type="button"
              onClick={() => {
                setStream({ state: "starting" });
                void window.api.simulator.startStream(paneId, udid);
              }}
              className="flex items-center gap-1 rounded border border-border bg-bg-secondary px-2 py-0.5 text-[10px] text-text-secondary hover:text-text-primary"
            >
              <RotateCw className="h-3 w-3" /> Restart
            </button>
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
