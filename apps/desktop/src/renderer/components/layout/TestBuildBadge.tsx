import { testBuildOf } from "@exegol/shared";
import { useAppVersion } from "../../hooks/use-trpc";

/** "TEST <sha>" on a `bun run package:local` build, nothing on a release or in dev */
export function TestBuildBadge() {
  const { data: version } = useAppVersion();
  const test = version ? testBuildOf(version) : null;
  if (!test) return null;
  return (
    <span
      className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-400"
      title={`Local test build ${version}${test.dirty ? " (uncommitted changes)" : ""}`}
    >
      TEST {test.commit}
      {test.dirty ? "*" : ""}
    </span>
  );
}

/** Version line for Settings: the commit spelled out on a test build */
export function AppVersionLine() {
  const { data: version } = useAppVersion();
  if (!version) return null;
  const test = testBuildOf(version);
  return (
    <div className="mt-auto px-3 pt-2 text-[10px] text-text-muted" title={version}>
      <div className="truncate">Exegol {version}</div>
      {test && (
        <div className="truncate text-amber-400">
          Test build, commit {test.commit}
          {test.dirty ? " + local changes" : ""}
        </div>
      )}
    </div>
  );
}
