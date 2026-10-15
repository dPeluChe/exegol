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
  groupId?: string;
}

/** The pick as saved in settings */
export interface SavedInput {
  id: string | null;
  label: string | null;
  groupId?: string | null;
}

/** Real mics: Chromium's "default" and "communications" entries are aliases of one of them, and
 *  entries without an id come before the mic was ever allowed */
const realMics = (devices: readonly Device[]): Device[] =>
  devices.filter(
    (d) =>
      d.kind === "audioinput" &&
      d.deviceId &&
      d.deviceId !== "default" &&
      d.deviceId !== "communications",
  );

/** The deviceId to open for the saved pick (null = system default). The OS can hand the same mic
 *  a new id (replugged, other port, update): then the one mic of its group, else of its label,
 *  is it (`relinked`). Two or more candidates mean not connected: never guess */
export function resolveInput(
  devices: readonly Device[],
  saved: SavedInput,
): { id: string | null; relinked: boolean } {
  const keep = { id: saved.id, relinked: false };
  if (!saved.id) return keep;
  const mics = realMics(devices);
  if (mics.length === 0 || mics.some((d) => d.deviceId === saved.id)) return keep;
  const only = (matches: Device[]) => (matches.length === 1 ? matches[0] : undefined);
  const match =
    (saved.groupId ? only(mics.filter((d) => d.groupId === saved.groupId)) : undefined) ??
    (saved.label ? only(mics.filter((d) => d.label === saved.label)) : undefined);
  return match ? { id: match.deviceId, relinked: true } : keep;
}

/** The mics to pick from, system default first, and the one selected. Labels are empty until the
 *  mic was allowed: those read "Microphone 1..." */
export function inputOptions(
  devices: readonly Device[],
  saved: SavedInput,
): { options: InputOption[]; value: string; unlabeled: boolean } {
  const mics = realMics(devices);
  const options: InputOption[] = [{ id: DEFAULT_INPUT, name: "System default" }];
  mics.forEach((d, i) => {
    options.push({ id: d.deviceId, name: d.label || `Microphone ${i + 1}` });
  });
  const { id } = resolveInput(devices, saved);
  if (id && !mics.some((d) => d.deviceId === id)) {
    options.push({ id, name: `${saved.label || "Selected input"} (not connected)` });
  }
  return {
    options,
    value: id ?? DEFAULT_INPUT,
    unlabeled: mics.some((d) => !d.label) || (mics.length === 0 && devices.length > 0),
  };
}

/** Peak sample under this for a whole dictation: the input gave no signal (muted, dead, wrong
 *  input). Auto gain lifts even a quiet room well above it */
export const FLAT_PEAK = 0.002;

export const peakOf = (samples: Float32Array, peak = 0): number => {
  let max = peak;
  for (const s of samples) {
    const a = s < 0 ? -s : s;
    if (a > max) max = a;
  }
  return max;
};

export const isFlat = (peak: number): boolean => peak < FLAT_PEAK;
