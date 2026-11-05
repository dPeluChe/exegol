import {
  compactDuration,
  IDLE_SUSPEND_DAYS,
  type IdleSuspendDays,
  type Settings,
  STUCK_TURN_MAX,
  STUCK_TURN_MIN,
  STUCK_TURN_PRESETS,
} from "@exegol/shared";
import { useState } from "react";
import { SECTION_HEADING, SelectRow } from "./settings-ui";

const OPTIONS: [IdleSuspendDays, string][] = IDLE_SUSPEND_DAYS.map((d) => [
  d,
  d === 0 ? "Off" : `${d} day${d === 1 ? "" : "s"}`,
]);

const CUSTOM = -1;
const STUCK_OPTIONS: [number, string][] = [
  ...STUCK_TURN_PRESETS.map((m): [number, string] => [
    m,
    m === 0 ? "Off" : compactDuration(m * 60_000),
  ]),
  [CUSTOM, "Custom…"],
];
const isPreset = (m: number) => (STUCK_TURN_PRESETS as readonly number[]).includes(m);

/** T200.10: alert on a turn past the limit or silent for 10 min */
function StuckTurnRow({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const [custom, setCustom] = useState(!isPreset(minutes));
  const [draft, setDraft] = useState(String(minutes || 90));
  const commit = (text: string) => {
    const m = Math.round(Number(text));
    if (Number.isFinite(m)) onChange(Math.min(STUCK_TURN_MAX, Math.max(STUCK_TURN_MIN, m)));
  };
  return (
    <div className="space-y-1.5">
      <SelectRow
        label={
          <>
            Alert when a turn runs longer than
            <span className="block text-[10px] text-text-muted">
              A desktop notification and an attention item, once per turn. Also when a running agent
              shows no output for 10 minutes. Never for terminals, pipeline or queue steps, or an
              agent waiting on you
            </span>
          </>
        }
        value={custom ? CUSTOM : minutes}
        options={STUCK_OPTIONS}
        onChange={(m) => {
          setCustom(m === CUSTOM);
          if (m === CUSTOM) commit(draft);
          else onChange(m);
        }}
      />
      {custom && (
        <label className="flex items-center justify-end gap-2 px-4 text-[11px] text-text-secondary">
          Minutes
          <input
            type="number"
            min={STUCK_TURN_MIN}
            max={STUCK_TURN_MAX}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            className="w-20 rounded-md border border-border bg-bg-tertiary px-2 py-1 text-[11px] text-text-primary"
          />
          <span className="text-text-muted">{compactDuration(minutes * 60_000)}</span>
        </label>
      )}
    </div>
  );
}

/** T205: idle auto-suspend */
export function SessionsSection({
  settings,
  onChange,
}: {
  settings: Pick<Settings, "idleSuspendDays" | "stuckTurnAlertMinutes">;
  onChange: (updates: Partial<Settings>) => void;
}) {
  return (
    <div>
      <h3 className={SECTION_HEADING}>Sessions</h3>
      <div className="space-y-2">
        <SelectRow
          label={
            <>
              Suspend sessions idle for
              <span className="block text-[10px] text-text-muted">
                No output and no typing: agents are suspended (Resume picks them up, their worktree
                stays as it is), terminals at their prompt are closed. Never one working, pinned in
                Watching, with Watch PR, waiting on you, in a pipeline, with uncommitted worktree
                changes or a server listening, nor a terminal running anything
              </span>
            </>
          }
          value={settings.idleSuspendDays}
          options={OPTIONS}
          onChange={(idleSuspendDays) => onChange({ idleSuspendDays })}
        />
        <StuckTurnRow
          minutes={settings.stuckTurnAlertMinutes}
          onChange={(stuckTurnAlertMinutes) => onChange({ stuckTurnAlertMinutes })}
        />
      </div>
    </div>
  );
}
