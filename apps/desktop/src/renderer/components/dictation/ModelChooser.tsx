import { formatChord, type ModelListItem } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { AudioLines } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useDictationStatus } from "../../hooks/use-trpc-dictation";
import { useModelAction, useModels, useStorageReport } from "../../hooks/use-trpc-models";
import { dismissDictation, startDictation } from "../../lib/dictation/controller";
import { dictationChord } from "../../lib/dictation/shortcut";
import { IS_MAC } from "../../lib/keymap";
import {
  chooserOptions,
  etaSeconds,
  formatEta,
  initialChoice,
  isBusy,
  languagesLabel,
  lowDisk,
  needsAttribution,
} from "../../lib/speech-models";
import { useDictationStore } from "../../stores/dictation";
import { formatBytes } from "../workspace/sections/resource-format";
import { OverlayButton } from "./overlay-ui";

/** Where the focus was before the chooser took it: dictation types there once it starts */
let returnFocus: HTMLElement | null = null;

function startFromChooser(): void {
  if (returnFocus?.isConnected) returnFocus.focus();
  returnFocus = null;
  void startDictation();
}

/** No speech model yet: pick one of the recommended, see what happens next, then download */
export function ModelChooser() {
  const { data: models } = useModels();
  const action = useModelAction();
  const downloadRequested = useDictationStore((s) => s.downloadRequested);
  const [picked, setPicked] = useState<string | null>(null);
  const checkedRadio = useRef<HTMLInputElement>(null);

  useMountEffect(() => {
    const prev = document.activeElement;
    returnFocus = prev instanceof HTMLElement ? prev : null;
    requestAnimationFrame(() => checkedRadio.current?.focus());
    // Downloaded while the overlay is still open: start dictating
    const off = window.api.onModelProgress((event) => {
      const s = useDictationStore.getState();
      if (event.status.state !== "ready" || s.phase !== "no-model" || !s.downloadRequested) return;
      s.set({ downloadRequested: false });
      startFromChooser();
    });
    return () => {
      off();
      if (returnFocus?.isConnected) returnFocus.focus();
      returnFocus = null;
    };
  });

  const options = chooserOptions(models ?? []);
  const selectedId = picked ?? initialChoice(options);
  const selected = options.find((m) => m.id === selectedId);
  const downloading = options.find((m) => isBusy(m));

  if (!models) return <div className="p-4 text-xs text-text-muted">Loading models...</div>;

  if (downloading && (downloadRequested || downloading.id === selectedId)) {
    return <Downloading key={downloading.id} model={downloading} />;
  }

  const choose = async () => {
    if (!selected) return;
    if (!selected.isDefault) await action.mutateAsync({ action: "setDefault", id: selected.id });
    if (selected.status.state === "ready") {
      startFromChooser();
      return;
    }
    useDictationStore.getState().set({ downloadRequested: true });
    action.mutate({ action: "download", id: selected.id });
  };

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <AudioLines className="h-4 w-4 text-accent" />
        Choose a speech model
      </div>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        Dictation runs on this {IS_MAC ? "Mac" : "computer"}. The model is downloaded once to
        ~/.exegol/models; your audio never leaves the machine.
      </p>
      <fieldset className="mt-3 flex flex-col gap-1.5">
        <legend className="sr-only">Speech model</legend>
        {options.map((model, i) => (
          <ModelCard
            key={model.id}
            model={model}
            checked={model.id === selectedId}
            recommended={i === 0}
            inputRef={model.id === selectedId ? checkedRadio : undefined}
            onSelect={() => setPicked(model.id)}
          />
        ))}
      </fieldset>
      <button
        type="button"
        onClick={() => void window.api.settings.open("models")}
        className="mt-1.5 text-[11px] text-accent hover:underline"
      >
        More models…
      </button>
      {selected && <NextSteps model={selected} />}
      {selected?.status.state === "failed" && (
        <p className="mt-2 text-xs text-error">{selected.status.error}</p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <OverlayButton onClick={dismissDictation}>Not now</OverlayButton>
        <OverlayButton
          variant="primary"
          disabled={!selected || action.isPending}
          onClick={() => void choose().catch(() => {})}
        >
          {selected?.status.state === "ready" ? `Use ${selected.name}` : "Download and start"}
        </OverlayButton>
      </div>
    </div>
  );
}

function ModelCard({
  model,
  checked,
  recommended,
  inputRef,
  onSelect,
}: {
  model: ModelListItem;
  checked: boolean;
  recommended: boolean;
  inputRef?: RefObject<HTMLInputElement>;
  onSelect: () => void;
}) {
  const ready = model.status.state === "ready";
  return (
    <label
      className={cn(
        "flex w-full cursor-pointer gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40",
        checked
          ? "border-accent bg-accent/10"
          : "border-border bg-bg-primary/40 hover:border-text-muted/40",
      )}
    >
      <input
        ref={inputRef}
        type="radio"
        name="dictation-model"
        value={model.id}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
          checked ? "border-accent" : "border-text-muted/60",
        )}
      >
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-text-primary">{model.name}</span>
          {recommended && (
            <span className="rounded-full bg-accent/15 px-1.5 py-px text-[10px] text-accent">
              Recommended
            </span>
          )}
          {ready && (
            <span className="rounded-full bg-success/15 px-1.5 py-px text-[10px] text-success">
              Downloaded
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[11px] text-text-secondary">{model.bestFor}</span>
        <span className="mt-0.5 block text-[10px] text-text-muted">
          {formatBytes(model.sizeBytes)} · {languagesLabel(model)} · {model.license}
        </span>
      </span>
    </label>
  );
}

function NextSteps({ model }: { model: ModelListItem }) {
  const { data: status } = useDictationStatus();
  const { data: storage } = useStorageReport();
  const chord = dictationChord();
  const ready = model.status.state === "ready";
  const steps = [
    !ready && `Download (${formatBytes(model.sizeBytes)})`,
    IS_MAC && status?.mic !== "granted" && "macOS asks for microphone access (first time)",
    `Dictation starts; press ${chord ? formatChord(chord, IS_MAC) : "the shortcut"} again to insert`,
  ].filter((s): s is string => !!s);
  return (
    <div className="mt-3 rounded-lg bg-bg-tertiary/50 px-3 py-2">
      <ol className="list-decimal space-y-0.5 pl-4 text-[11px] text-text-secondary">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {!ready && lowDisk(storage?.freeBytes, model.sizeBytes) && (
        <p className="mt-1.5 text-[11px] text-warning">
          Only {formatBytes(storage?.freeBytes ?? 0)} free on disk
        </p>
      )}
      {needsAttribution(model.license) && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-text-muted">{model.attribution}</p>
      )}
    </div>
  );
}

function Downloading({ model }: { model: ModelListItem }) {
  const { status } = model;
  const received = status.state === "downloading" ? status.receivedBytes : model.sizeBytes;
  const [first] = useState(() => ({ at: Date.now(), bytes: received }));
  const percent = Math.min(100, Math.round((received / model.sizeBytes) * 100));
  const eta =
    status.state === "downloading"
      ? etaSeconds(first, { at: Date.now(), bytes: received }, model.sizeBytes)
      : null;
  const label =
    status.state === "verifying"
      ? "Verifying"
      : status.state === "extracting"
        ? "Unpacking"
        : `${formatBytes(received)} of ${formatBytes(model.sizeBytes)}${eta === null ? "" : ` · ${formatEta(eta)}`}`;
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <AudioLines className="h-4 w-4 text-accent" />
        Downloading {model.name}
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-tertiary"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Downloading ${model.name}`}
      >
        <div
          className={cn(
            "h-full bg-accent transition-[width]",
            status.state !== "downloading" && "animate-pulse",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] tabular-nums text-text-secondary">{label}</p>
      <p className="mt-2 text-[11px] text-text-muted">
        You can close this; the download continues in Settings &gt; Models. Dictation starts when it
        is ready.
      </p>
      <div className="mt-3 flex justify-end">
        <OverlayButton onClick={dismissDictation}>Close</OverlayButton>
      </div>
    </div>
  );
}
