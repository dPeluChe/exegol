import {
  chordFromEvent,
  DEFAULT_DICTATION_SHORTCUT,
  type DictationSettings as DictationPrefs,
  dictationSettingsOf,
  formatChord,
  parseChord,
  type Settings,
} from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Mic } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useDictationStatus, useMicAction } from "../../hooks/use-trpc-dictation";
import { IS_MAC, PLATFORM } from "../../lib/keymap";
import { SEMANTIC_BADGE } from "../../lib/semantic-colors";
import { shortcutClash } from "../../lib/shortcuts";
import { DictationHistory } from "./DictationHistory";
import { SMALL_BUTTON, SwitchRow } from "./settings-ui";

interface Props {
  settings: Settings;
  onChange: (updates: Partial<Settings>) => void;
}

const SECTION = "mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted";
const SELECT =
  "rounded-md border border-border bg-bg-tertiary px-2 py-1 text-[11px] text-text-primary";

const PAUSE_MEDIA_HINT = IS_MAC
  ? "Music and Spotify pause while you talk and resume after, unless you changed them meanwhile. macOS asks once per app to let Exegol control it"
  : "Players that support MPRIS pause while you talk and resume after (needs playerctl)";

const MIC_LABEL: Record<string, { text: string; tone: keyof typeof SEMANTIC_BADGE }> = {
  granted: { text: "Allowed", tone: "success" },
  denied: { text: "Denied", tone: "error" },
  restricted: { text: "Restricted by the system", tone: "error" },
  "not-determined": { text: "Not asked yet", tone: "warning" },
  unknown: { text: "Unknown", tone: "muted" },
};

export function DictationSettings({ settings, onChange }: Props) {
  const prefs = dictationSettingsOf(settings.dictation);
  const set = (patch: Partial<DictationPrefs>) => onChange({ dictation: { ...prefs, ...patch } });

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Mic className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">Voice dictation</h3>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          Speak and the text goes into the focused pane: a terminal (pasted, not sent), a browser
          page's focused field or the code editor. Speech is transcribed on this machine with the
          model chosen in Models: audio never leaves it and is never saved.
        </p>
      </div>

      <SwitchRow
        label="Dictation"
        description="The shortcut and the status bar mic"
        value={prefs.enabled}
        onToggle={() => set({ enabled: !prefs.enabled })}
      />

      <div>
        <h3 className={SECTION}>Shortcut</h3>
        <ShortcutRow value={prefs.shortcut} onChange={(shortcut) => set({ shortcut })} />
        <p className="mt-1 text-[10px] text-text-muted">
          Press it to start and again to insert, or hold it while you talk. Esc cancels.
        </p>
      </div>

      <MicSection />

      <div>
        <h3 className={SECTION}>Recording</h3>
        <div className="space-y-2">
          <SwitchRow
            label="Press Enter after dictation"
            description="In a terminal, send the text right away instead of leaving it to review"
            value={prefs.pressEnter}
            onToggle={() => set({ pressEnter: !prefs.pressEnter })}
          />
          {PLATFORM !== "win32" && (
            <SwitchRow
              label="Pause music while dictating"
              description={PAUSE_MEDIA_HINT}
              value={prefs.pauseMedia}
              onToggle={() => set({ pauseMedia: !prefs.pauseMedia })}
            />
          )}
          <SelectRow
            label="Longest dictation"
            value={prefs.maxSeconds}
            options={[60, 120, 300, 600].map((s) => [s, `${s / 60} min`])}
            onChange={(maxSeconds) => set({ maxSeconds })}
          />
          <SelectRow
            label="Stop on its own after a pause of"
            value={prefs.autoStopSilenceSec}
            options={[0, 2, 3, 5, 10].map((s) => [s, s === 0 ? "Never" : `${s} s`])}
            onChange={(autoStopSilenceSec) => set({ autoStopSilenceSec })}
          />
          <SelectRow
            label="Free the model's memory after"
            value={prefs.idleUnloadMinutes}
            options={[5, 10, 30, 60].map((m) => [m, `${m} min idle`])}
            onChange={(idleUnloadMinutes) => set({ idleUnloadMinutes })}
          />
        </div>
      </div>

      <div>
        <h3 className={SECTION}>History</h3>
        <div className="mb-3 space-y-2">
          <SelectRow
            label="Keep dictations for"
            value={prefs.retentionDays}
            options={[1, 7, 30, 90, 365].map((d) => [d, d === 1 ? "1 day" : `${d} days`])}
            onChange={(retentionDays) => set({ retentionDays })}
          />
          <SelectRow
            label="Keep at most"
            value={prefs.retentionMax}
            options={[50, 100, 500, 1000, 5000].map((n) => [n, `${n} dictations`])}
            onChange={(retentionMax) => set({ retentionMax })}
          />
        </div>
        <DictationHistory />
      </div>
    </div>
  );
}

function ShortcutRow({ value, onChange }: { value: string; onChange: (keys: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const chord = parseChord(value);
  return (
    <div>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-bg-secondary px-4 py-2.5">
        <span className="font-mono text-xs text-text-primary">
          {chord ? formatChord(chord, IS_MAC) : value}
        </span>
        <button
          type="button"
          onClick={() => {
            setProblem(null);
            setRecording(true);
          }}
          onBlur={() => setRecording(false)}
          onKeyDown={(e) => {
            if (!recording) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "Escape") {
              setRecording(false);
              return;
            }
            if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return;
            const keys = chordFromEvent(e, IS_MAC);
            setRecording(false);
            if (!keys) {
              setProblem(`Use ${IS_MAC ? "Cmd or Ctrl" : "Ctrl"} with one more key`);
              return;
            }
            const clash = shortcutClash(keys);
            if (clash) {
              setProblem(`That is ${clash}`);
              return;
            }
            onChange(keys);
          }}
          className={cn(
            "rounded border px-2 py-0.5 text-[10px]",
            recording
              ? "border-accent text-accent"
              : "border-border text-text-muted hover:text-text-secondary",
          )}
        >
          {recording ? "Press the keys... (Esc cancels)" : "Change"}
        </button>
        {value !== DEFAULT_DICTATION_SHORTCUT && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_DICTATION_SHORTCUT)}
            className="text-[10px] text-text-muted hover:text-text-secondary"
          >
            Reset
          </button>
        )}
      </div>
      {problem && <p className="mt-1 text-[10px] text-error">{problem}</p>}
    </div>
  );
}

function MicSection() {
  const { data: status } = useDictationStatus();
  const mic = useMicAction();
  if (!status) return null;
  const label = MIC_LABEL[status.mic] ?? MIC_LABEL.unknown;
  return (
    <div>
      <h3 className={SECTION}>Microphone and model</h3>
      <div className="space-y-2 rounded-xl border border-border bg-bg-secondary px-4 py-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="flex-1 text-text-secondary">Microphone access</span>
          {label && (
            <span
              className={cn("rounded-full px-2 py-0.5 text-[10px]", SEMANTIC_BADGE[label.tone])}
            >
              {label.text}
            </span>
          )}
          {IS_MAC && status.mic === "not-determined" && (
            <button type="button" className={SMALL_BUTTON} onClick={() => mic.mutate("requestMic")}>
              Allow
            </button>
          )}
          {IS_MAC && (status.mic === "denied" || status.mic === "restricted") && (
            <button
              type="button"
              className={SMALL_BUTTON}
              onClick={() => mic.mutate("openMicSettings")}
            >
              Open System Settings
            </button>
          )}
        </div>
        {!status.engineAvailable && (
          <p className="text-[10px] text-error">
            Dictation cannot run here: {status.engineError ?? "the speech engine did not load"}. The
            shortcut, the status bar mic and the overlay stay hidden.
          </p>
        )}
        {status.platform === "linux" && (
          <p className="text-[10px] text-text-muted">
            Linux has no microphone prompt: the system's default input is used.
          </p>
        )}
        <div className="flex items-center gap-2 text-xs">
          <span className="flex-1 text-text-secondary">
            Model: <span className="text-text-primary">{status.model.name}</span>
            {status.model.kind === "streaming" && (
              <span className="text-text-muted"> (live partial text)</span>
            )}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px]",
              SEMANTIC_BADGE[status.model.ready ? "success" : "warning"],
            )}
          >
            {status.model.ready ? "Downloaded" : "Not downloaded"}
          </span>
          <button
            type="button"
            className={SMALL_BUTTON}
            onClick={() => void window.api.settings.open("models")}
          >
            Models
          </button>
        </div>
      </div>
    </div>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: ReactNode;
  value: number;
  options: [number, string][];
  onChange: (value: number) => void;
}) {
  const known = options.some(([v]) => v === value);
  return (
    <label className="flex items-center gap-3 rounded-xl border border-border bg-bg-secondary px-4 py-2.5 text-xs">
      <span className="flex-1 text-text-secondary">{label}</span>
      <select className={SELECT} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {!known && <option value={value}>{value}</option>}
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
