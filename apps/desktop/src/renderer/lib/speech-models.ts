import type {
  LocalBenchModel,
  LocalBenchRun,
  ModelListItem,
  PublicBenchmark,
  SpeechModelEntry,
} from "@exegol/shared";

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

/** Settings > Models: what is on disk (or on its way) first, the rest to download. Downloads sit
 *  with Installed so their progress stays visible while Available is collapsed */
export function groupModels(models: readonly ModelListItem[]): {
  installed: ModelListItem[];
  available: ModelListItem[];
} {
  const rank = (m: ModelListItem) => (m.isDefault ? 0 : m.status.state === "ready" ? 1 : 2);
  const installed = models
    .filter((m) => m.status.state === "ready" || isBusy(m))
    .sort((a, b) => rank(a) - rank(b));
  return { installed, available: models.filter((m) => !installed.includes(m)) };
}

/** x real time from a real-time factor; null when there is nothing to divide */
export const speedFromRtf = (rtf: number): number | null => (rtf > 0 ? 1 / rtf : null);

export const runForLanguage = (runs: readonly LocalBenchRun[], language: string) =>
  runs.find((r) => r.language === language) ?? null;

/** The run for the dictation language, else the newest of any language */
export const benchRunFor = (runs: readonly LocalBenchRun[], language: string) =>
  runForLanguage(runs, language) ?? runs[0] ?? null;

export const localResult = (run: LocalBenchRun | null, modelId: string) =>
  run?.models.find((m) => m.modelId === modelId) ?? null;

/** Self-scored when any clip was graded against this model's own saved text */
export const isSelfScored = (m: LocalBenchModel): boolean => m.selfScoredClips > 0;

export interface RankRow {
  id: string;
  name: string;
  isDefault: boolean;
  werPercent: number | null;
  speedX: number | null;
  /** local: your corrected recordings; public: the catalog's first source for the language */
  basis: "local" | "public" | null;
  publicSource: PublicBenchmark | null;
  selfScored: boolean;
}

/** Models that speak `language`, ranked by your WER where you corrected references, then by the
 *  public WER, then the ones with no score */
export function rankModels(
  models: readonly ModelListItem[],
  runs: readonly LocalBenchRun[],
  language: string,
): RankRow[] {
  const run = runForLanguage(runs, language);
  const order = { local: 0, public: 1, none: 2 };
  return models
    .filter(
      (m) => m.engineAvailable && (m.languages.length === 0 || m.languages.includes(language)),
    )
    .map((m): RankRow => {
      const local = localResult(run, m.id);
      const pub = m.benchmarks?.find((b) => b.language === language) ?? null;
      const useLocal = local !== null && local.correctedClips > 0;
      return {
        id: m.id,
        name: m.name,
        isDefault: m.isDefault,
        werPercent: useLocal ? local.werPercent : (pub?.werPercent ?? null),
        speedX: useLocal ? speedFromRtf(local.rtf) : (pub?.speedX ?? null),
        basis: useLocal ? "local" : pub ? "public" : null,
        publicSource: pub,
        selfScored: local !== null && isSelfScored(local),
      };
    })
    .sort(
      (a, b) =>
        order[a.basis ?? "none"] - order[b.basis ?? "none"] ||
        (a.werPercent ?? 0) - (b.werPercent ?? 0) ||
        a.name.localeCompare(b.name),
    );
}
