import type { LocalBenchRun, ModelListItem, PublicBenchmark } from "@exegol/shared";
import { ExternalLink } from "lucide-react";
import { openInBrowser } from "../../lib/open-in-browser";
import { SEMANTIC_BADGE } from "../../lib/semantic-colors";
import { isSelfScored, localResult, rankModels, speedFromRtf } from "../../lib/speech-models";

const BADGE = "rounded-full px-1.5 py-px text-[10px]";
const LINK = "inline-flex items-center gap-0.5 text-accent hover:underline";

const pct = (n: number) => `${n.toFixed(1)}%`;
const speed = (x: number | null | undefined) =>
  x ? `${x < 10 ? x.toFixed(1) : Math.round(x)}x` : "-";
const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function SourceLink({ source, url }: { source: string; url: string }) {
  return (
    <button type="button" className={LINK} onClick={() => openInBrowser(url)}>
      {source} <ExternalLink className="h-2.5 w-2.5" />
    </button>
  );
}

/** The local run's verdict on how far to trust it */
function TrustBadge({ selfScored, corrected }: { selfScored: boolean; corrected: number }) {
  if (selfScored) {
    return (
      <span
        className={`${BADGE} ${SEMANTIC_BADGE.warning}`}
        title="Some clips were scored against this model's own saved text: its WER looks better than it is"
      >
        self-scored
      </span>
    );
  }
  return (
    <span className={`${BADGE} ${corrected > 0 ? SEMANTIC_BADGE.success : SEMANTIC_BADGE.muted}`}>
      {corrected} corrected
    </span>
  );
}

/** A model card's "Benchmarks" lines: public WER per source, then your latest local run */
export function ModelBenchmarks({
  model,
  run,
}: {
  model: ModelListItem;
  run: LocalBenchRun | null;
}) {
  const bySource = new Map<string, PublicBenchmark[]>();
  for (const b of model.benchmarks ?? [])
    bySource.set(b.source, [...(bySource.get(b.source) ?? []), b]);
  const local = localResult(run, model.id);
  if (bySource.size === 0 && !local) return null;
  return (
    <div className="mt-1.5 space-y-0.5 text-[11px] text-text-muted">
      {[...bySource.values()].map((list) => {
        const first = list[0] as PublicBenchmark;
        return (
          <p
            key={first.source}
            className="flex flex-wrap items-center gap-x-1.5"
            title={first.note}
          >
            <span className="text-text-secondary">Benchmarks</span>
            <span>
              {first.dataset} WER{" "}
              {list.map((b) => `${b.language.toUpperCase()} ${pct(b.werPercent)}`).join(" · ")}
              {first.speedX ? ` · ${speed(first.speedX)} real time` : ""}
            </span>
            <SourceLink source={first.source} url={first.url} />
          </p>
        );
      })}
      {run && local && (
        <p className="flex flex-wrap items-center gap-x-1.5">
          <span className="text-text-secondary">Your tests</span>
          <span>
            WER {pct(local.werPercent)} · CER {pct(local.cerPercent)} ·{" "}
            {speed(speedFromRtf(local.rtf))} real time · {local.clips} clips ·{" "}
            {run.language.toUpperCase()} {day(run.runAt)}
          </span>
          <TrustBadge selfScored={isSelfScored(local)} corrected={local.correctedClips} />
        </p>
      )}
    </div>
  );
}

/** Ranking for the dictation language: your corrected results first, then public WER */
export function ModelRanking({
  models,
  runs,
  language,
}: {
  models: readonly ModelListItem[];
  runs: readonly LocalBenchRun[];
  language: string;
}) {
  const rows = rankModels(models, runs, language);
  const hasLocal = runs.some((r) => r.language === language);
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-xs font-semibold text-text-primary">
          Ranking for {language.toUpperCase()}
        </span>
        <span className="text-[10px] text-text-muted">lower WER is better</span>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-text-muted">
            <th className="pb-1 font-normal">#</th>
            <th className="pb-1 font-normal">Model</th>
            <th className="pb-1 text-right font-normal">WER</th>
            <th className="pb-1 text-right font-normal">Speed</th>
            <th className="pb-1 pl-3 font-normal">Basis</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id} className="text-text-secondary">
              <td className="py-0.5 text-text-muted">{i + 1}</td>
              <td className="py-0.5">
                {row.name}
                {row.isDefault && (
                  <span className={`${BADGE} ml-1.5 bg-accent/15 text-accent`}>Default</span>
                )}
              </td>
              <td className="py-0.5 text-right tabular-nums">
                {row.werPercent === null ? "-" : pct(row.werPercent)}
              </td>
              <td className="py-0.5 text-right tabular-nums">{speed(row.speedX)}</td>
              <td className="py-0.5 pl-3 text-text-muted">
                {row.basis === "local" && "your tests"}
                {row.basis === "public" && row.publicSource && (
                  <SourceLink source={row.publicSource.source} url={row.publicSource.url} />
                )}
                {row.selfScored && (
                  <span className={`${BADGE} ml-1 ${SEMANTIC_BADGE.warning}`}>self</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!hasLocal && (
        <p className="mt-2 text-[10px] leading-relaxed text-text-muted">
          No local results for this language yet. Keep recordings (Settings &gt; Dictation), correct
          a few texts, run the bench with --save (docs/GUIDES/DICTATION_BENCH.md).
        </p>
      )}
    </div>
  );
}
