import { IDLE_SUSPEND_DAYS, type IdleSuspendDays, type Settings } from "@exegol/shared";
import { SECTION_HEADING, SelectRow } from "./settings-ui";

const OPTIONS: [IdleSuspendDays, string][] = IDLE_SUSPEND_DAYS.map((d) => [
  d,
  d === 0 ? "Off" : `${d} day${d === 1 ? "" : "s"}`,
]);

/** T205: idle auto-suspend */
export function SessionsSection({
  settings,
  onChange,
}: {
  settings: Pick<Settings, "idleSuspendDays">;
  onChange: (updates: Partial<Settings>) => void;
}) {
  return (
    <div>
      <h3 className={SECTION_HEADING}>Sessions</h3>
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
    </div>
  );
}
