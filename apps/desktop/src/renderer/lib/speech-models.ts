import type { ModelListItem, SpeechModelEntry } from "@exegol/shared";

export function languagesLabel(model: Pick<SpeechModelEntry, "languages" | "languageSummary">) {
  if (model.languageSummary) return model.languageSummary;
  if (model.languages.length <= 3) return model.languages.join(", ").toUpperCase();
  return `${model.languages.length} languages`;
}

/** The overlay's short list: the catalog's featured models, in order, never a non-commercial one */
export function chooserOptions(models: readonly ModelListItem[]): ModelListItem[] {
  return models
    .filter((m) => m.featured !== undefined && m.engineAvailable && m.commercialUse !== false)
    .sort((a, b) => (a.featured ?? 0) - (b.featured ?? 0));
}

/** Preselected: one already downloaded, else one downloading, else the recommended one */
export function initialChoice(options: readonly ModelListItem[]): string | null {
  const ready = options.find((m) => m.status.state === "ready");
  const busy = options.find((m) => isBusy(m));
  return (ready ?? busy ?? options[0])?.id ?? null;
}

export const isBusy = (m: ModelListItem): boolean =>
  m.status.state === "downloading" ||
  m.status.state === "verifying" ||
  m.status.state === "extracting";

/** CC-BY asks for the credit next to the model */
export const needsAttribution = (license: string): boolean => /^CC-BY/i.test(license);

/** Free space worth a warning: under twice what the model needs */
export const lowDisk = (freeBytes: number | null | undefined, sizeBytes: number): boolean =>
  freeBytes !== null && freeBytes !== undefined && freeBytes < sizeBytes * 2;

export interface ProgressSample {
  at: number;
  bytes: number;
}

/** Seconds left from the rate since `first`; null until there is a rate to trust */
export function etaSeconds(first: ProgressSample, now: ProgressSample, total: number) {
  const secs = (now.at - first.at) / 1000;
  const rate = (now.bytes - first.bytes) / secs;
  if (secs < 2 || !(rate > 0)) return null;
  return Math.max(0, Math.round((total - now.bytes) / rate));
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s left`;
  return `${Math.round(seconds / 60)} min left`;
}
