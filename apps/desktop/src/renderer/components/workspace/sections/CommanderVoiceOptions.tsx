import { useQueryClient } from "@tanstack/react-query";
import { useAct } from "../../../hooks/use-act";
import { useCommanderVoice, VOICE_KEY } from "../../../hooks/use-commander-voice";
import { FilterChip } from "../../common/FilterChip";

const SPEEDS = [0.8, 0.9, 1, 1.1, 1.25];
const PICKER =
  "rounded border border-border bg-bg-primary px-1 py-0.5 text-[11px] text-text-secondary outline-none focus:border-accent";

/** Reads new replies aloud when on; the picker lists the installed voice model's speakers */
export function CommanderVoiceOptions({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const { act } = useAct("Voice not changed");
  const voice = useCommanderVoice().data;
  if (!voice) return null;
  const set = async (input: { auto?: boolean; voice?: string; speed?: number }) => {
    if (await act("commander.setVoice", input))
      void queryClient.invalidateQueries({ queryKey: VOICE_KEY });
  };
  const { settings } = voice;
  if (!voice.ready) {
    return (
      <FilterChip active={false} onClick={() => void window.api.settings.open("models")}>
        <span title="Download a voice in Settings > Models to hear its replies">Voice</span>
      </FilterChip>
    );
  }
  const toggle = (
    <FilterChip active={settings.auto} onClick={() => void set({ auto: !settings.auto })}>
      <span title="Read each new reply aloud, on this machine">
        {settings.auto ? "Voice on" : "Voice off"}
      </span>
    </FilterChip>
  );
  if (compact) return toggle;
  return (
    <div className="flex items-center gap-1">
      {toggle}
      <select
        value={settings.voice}
        onChange={(e) => void set({ voice: e.target.value })}
        aria-label="Voice"
        className={PICKER}
      >
        {voice.voices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
      <select
        value={settings.speed}
        onChange={(e) => void set({ speed: Number(e.target.value) })}
        aria-label="Reading speed"
        title="Reading speed"
        className={PICKER}
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
    </div>
  );
}
