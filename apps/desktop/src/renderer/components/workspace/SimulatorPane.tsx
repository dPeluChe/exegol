import { AXE_INSTALL_COMMAND, type SimDevice } from "@exegol/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Download, ExternalLink, Home, Power, Smartphone } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useSimDevices, useSimulatorSupport } from "../../hooks/use-simulator";
import { IS_MAC } from "../../lib/keymap";
import { trpcMutate } from "../../lib/trpc-client";
import { toastError, useToastStore } from "../../stores/toasts";
import { type Pane, useWorkspaceStore } from "../../stores/workspace";
import { LoadingSpinner } from "../common";
import { CopyCommand } from "../common/CopyCommand";
import { SimulatorScreen } from "./SimulatorScreen";

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
  if (!IS_MAC) return <Notice title="The Simulator pane needs macOS" />;
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
  // The default is pinned once shown: another device booting later must not take the pane
  const pinned = pane.simUdid;
  useEffect(() => {
    if (!pinned && udid) updatePane(paneId, { simUdid: udid });
  }, [pinned, udid, paneId, updatePane]);
  const refreshDevices = () =>
    queryClient.invalidateQueries({ queryKey: ["simulator", "devices"] });

  const power = useMutation({
    mutationFn: (action: "boot" | "shutdown") => trpcMutate(`simulator.${action}`, { udid }),
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
  else body = <SimulatorScreen key={udid} paneId={paneId} udid={udid} deviceName={device.name} />;

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
          disabled={starting}
          onClick={() => power.mutate(booted ? "shutdown" : "boot")}
        >
          <Power className={booted ? "h-3.5 w-3.5 text-success" : "h-3.5 w-3.5"} />
        </ToolButton>
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}
