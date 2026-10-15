import type { DictationSettings } from "@exegol/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { DEFAULT_INPUT, inputOptions } from "../../lib/dictation/inputs";
import { SelectRow } from "./settings-ui";

const INPUTS_KEY = ["dictation", "audio-inputs"];

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
  const { data: devices = [] } = useQuery({ queryKey: INPUTS_KEY, queryFn: listDevices });
  useMountEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: INPUTS_KEY });
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  });
  const { options, unlabeled } = inputOptions(devices, {
    id: prefs.inputDeviceId,
    label: prefs.inputDeviceLabel,
  });
  return (
    <div>
      <SelectRow
        label="Input"
        value={prefs.inputDeviceId ?? DEFAULT_INPUT}
        options={options.map((o) => [o.id, o.name])}
        onChange={(id) => {
          const picked = options.find((o) => o.id === id);
          set(
            id === DEFAULT_INPUT
              ? { inputDeviceId: null, inputDeviceLabel: null }
              : { inputDeviceId: id, inputDeviceLabel: picked?.name ?? null },
          );
        }}
      />
      <p className="mt-1 text-[10px] text-text-muted">
        {unlabeled
          ? "Names show once the microphone is allowed: grant access or start one dictation."
          : "If the picked input is missing, dictation uses the system default and says so."}
      </p>
    </div>
  );
}
