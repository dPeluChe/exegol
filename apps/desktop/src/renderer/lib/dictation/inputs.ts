/** "" stands for the system default in the Input select */
export const DEFAULT_INPUT = "";

export interface InputOption {
  id: string;
  name: string;
}

interface Device {
  kind: string;
  deviceId: string;
  label: string;
}

/** The mics to pick from, system default first. Chromium's "default" and "communications"
 *  entries are aliases of a real device and are left out. Labels are empty until the mic was
 *  allowed: those read "Microphone 1..." */
export function inputOptions(
  devices: readonly Device[],
  saved: { id: string | null; label: string | null },
): { options: InputOption[]; unlabeled: boolean } {
  const mics = devices.filter(
    (d) =>
      d.kind === "audioinput" &&
      d.deviceId &&
      d.deviceId !== "default" &&
      d.deviceId !== "communications",
  );
  const options: InputOption[] = [{ id: DEFAULT_INPUT, name: "System default" }];
  mics.forEach((d, i) => {
    options.push({ id: d.deviceId, name: d.label || `Microphone ${i + 1}` });
  });
  if (saved.id && !mics.some((d) => d.deviceId === saved.id)) {
    options.push({ id: saved.id, name: `${saved.label || "Selected input"} (not connected)` });
  }
  return {
    options,
    unlabeled: mics.some((d) => !d.label) || (mics.length === 0 && devices.length > 0),
  };
}
