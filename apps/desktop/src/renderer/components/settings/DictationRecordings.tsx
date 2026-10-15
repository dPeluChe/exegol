import {
  DICTATION_RECORDING_RETENTION_DAYS,
  type DictationSettings as DictationPrefs,
} from "@exegol/shared";
import { FolderOpen, Trash2 } from "lucide-react";
import { useState } from "react";
import { useDictationRecordings, useRecordingsAction } from "../../hooks/use-trpc-dictation";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { formatBytes } from "../workspace/sections/resource-format";
import { SECTION_HEADING, SelectRow, SMALL_BUTTON, SwitchRow } from "./settings-ui";

const plural = (n: number) => `${n} recording${n === 1 ? "" : "s"}`;

/** Audio and text of each dictation, kept on disk to compare speech models offline */
export function DictationRecordings({
  prefs,
  set,
}: {
  prefs: DictationPrefs;
  set: (patch: Partial<DictationPrefs>) => void;
}) {
  const { data: summary } = useDictationRecordings();
  const action = useRecordingsAction();
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div>
      <h3 className={SECTION_HEADING}>Recordings</h3>
      <div className="space-y-2">
        <SwitchRow
          label="Keep recordings for model testing"
          description="Audio and text stay on this Mac in ~/.exegol/dictation-audio"
          value={prefs.keepRecordings}
          onToggle={() => set({ keepRecordings: !prefs.keepRecordings })}
        />
        <SelectRow
          label="Delete recordings after"
          value={prefs.recordingsRetentionDays}
          options={DICTATION_RECORDING_RETENTION_DAYS.map((d) => [d, `${d} days`])}
          onChange={(recordingsRetentionDays) => set({ recordingsRetentionDays })}
        />
        <div className="space-y-1.5 rounded-xl border border-border bg-bg-secondary px-4 py-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="flex-1 text-text-secondary">
              {summary ? `${plural(summary.count)} · ${formatBytes(summary.bytes)}` : "Counting..."}
            </span>
            <button
              type="button"
              className={SMALL_BUTTON}
              onClick={() => action.mutate("openRecordings")}
            >
              <FolderOpen className="h-3 w-3" /> Open folder
            </button>
            <button
              type="button"
              className={SMALL_BUTTON}
              disabled={!summary?.count}
              onClick={() => setConfirmClear(true)}
            >
              <Trash2 className="h-3 w-3" /> Clear recordings
            </button>
          </div>
          {summary && summary.projects.length > 1 && (
            <ul className="space-y-0.5">
              {summary.projects.map((p) => (
                <li
                  key={p.projectId ?? "none"}
                  className="flex gap-2 text-[10px] text-text-muted tabular-nums"
                >
                  <span className="flex-1 truncate">
                    {p.projectName ?? (p.projectId ? "Deleted project" : "No project")}
                  </span>
                  <span>{plural(p.count)}</span>
                  <span>{formatBytes(p.bytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-[10px] text-text-muted">
          Turning this off keeps what was saved: clear it here or let the retention remove it.
        </p>
      </div>
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear dictation recordings"
        description="Every kept recording (audio and text) is deleted. The dictation history stays. This cannot be undone."
        confirmLabel="Clear recordings"
        variant="destructive"
        onConfirm={() => action.mutate("clearRecordings")}
      />
    </div>
  );
}
