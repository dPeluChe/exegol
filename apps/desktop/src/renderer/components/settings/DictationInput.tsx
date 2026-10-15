import type { DictationSettings } from "@exegol/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { openMicTest } from "../../lib/dictation/capture";
import { DEFAULT_INPUT, inputOptions } from "../../lib/dictation/inputs";
import { SelectRow, SMALL_BUTTON } from "./settings-ui";

const INPUTS_KEY = ["dictation", "audio-inputs"];
/** The test closes the mic on its own after this */
const TEST_MS = 15_000;

const listDevices = () => navigator.mediaDevices.enumerateDevices();

/** The mic dictation opens; refreshed when one is plugged in or out */
export function DictationInput({
  prefs,
  set,
}: {
  prefs: DictationSettings;
  set: (patch: Partial<DictationSettings>) => void;
}) {
  const queryClient = useQueryClient();
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const { data: devices = [] } = useQuery({ queryKey: INPUTS_KEY, queryFn: listDevices });
  useMountEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: INPUTS_KEY });
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  });
  const { options, value, unlabeled } = inputOptions(devices, {
    id: prefs.inputDeviceId,
    label: prefs.inputDeviceLabel,
    groupId: prefs.inputDeviceGroupId,
  });
  const startTest = async () => {
    setTestError(null);
    const mic = await window.api.dictation.testMic().catch(() => "unknown" as const);
    if (mic === "denied" || mic === "restricted") {
      setTestError("Microphone access is denied: allow it above");
      return;
    }
    setTesting(true);
  };
  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SelectRow
            label="Input"
            value={value}
            options={options.map((o) => [o.id, o.name])}
            onChange={(id) => {
              const picked = options.find((o) => o.id === id);
              const device = devices.find((d) => d.kind === "audioinput" && d.deviceId === id);
              set(
                id === DEFAULT_INPUT
                  ? { inputDeviceId: null, inputDeviceLabel: null, inputDeviceGroupId: null }
                  : {
                      inputDeviceId: id,
                      inputDeviceLabel: picked?.name ?? null,
                      inputDeviceGroupId: device?.groupId || null,
                    },
              );
            }}
          />
        </div>
        <button
          type="button"
          className={SMALL_BUTTON}
          onClick={() => (testing ? setTesting(false) : void startTest())}
        >
          {testing ? "Stop" : "Test"}
        </button>
      </div>
      {testing && (
        <MicTestMeter
          key={value}
          deviceId={value || null}
          onEnd={(error) => {
            setTesting(false);
            setTestError(error);
          }}
        />
      )}
      {testError && <p className="mt-1 text-[10px] text-error">{testError}</p>}
      <p className="mt-1 text-[10px] text-text-muted">
        {unlabeled
          ? "Names show once the microphone is allowed: grant access, press Test or start one dictation."
          : "A missing input falls back to the system default, and is used again once it is back. A new pick applies from the next dictation."}
      </p>
    </div>
  );
}

/** Mounted only while testing: opens the mic, draws its level, closes it on unmount, after
 *  TEST_MS, or once the window is hidden */
function MicTestMeter({
  deviceId,
  onEnd,
}: {
  deviceId: string | null;
  onEnd: (error: string | null) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState<string | null>(null);
  useMountEffect(() => {
    let closed = false;
    let frame = 0;
    let stop: (() => void) | null = null;
    const end = (error: string | null = null) => {
      if (!closed) onEnd(error);
    };
    const timer = window.setTimeout(() => end(), TEST_MS);
    const hidden = () => {
      if (document.visibilityState === "hidden") end();
    };
    document.addEventListener("visibilitychange", hidden);
    const data = new Uint8Array(1024);
    openMicTest(deviceId)
      .then((test) => {
        if (closed) return test.stop();
        stop = test.stop;
        setLabel(
          test.input === "fallback"
            ? "Picked input not connected: testing the system default"
            : test.label || null,
        );
        const draw = () => {
          frame = requestAnimationFrame(draw);
          test.analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += ((v - 128) / 128) ** 2;
          // Same scale as the overlay's bars: normal speech fills most of it
          const level = Math.min(1, Math.sqrt(sum / data.length) * 6);
          if (bar.current) bar.current.style.width = `${Math.round(level * 100)}%`;
        };
        draw();
      })
      .catch((err: unknown) => end(`Could not open the microphone: ${errorText(err)}`));
    return () => {
      closed = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", hidden);
      stop?.();
    };
  });
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
        <div ref={bar} className="h-full w-0 rounded-full bg-accent" />
      </div>
      <span className="max-w-[50%] truncate text-[10px] text-text-muted">
        {label ?? "Speak: the bar should move"}
      </span>
    </div>
  );
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
