import { type CliInstallCopy, describeInstallCopy as describe } from "@exegol/shared";
import { CopyCommand } from "../common/CopyCommand";

/** How this CLI is installed. With 2+ copies on PATH: which one runs and how to remove the
 *  others (an update can land in a copy that never runs). Commands are shown, never run */
export function CliInstallCopies({ copies }: { copies: CliInstallCopy[] | undefined }) {
  const [running, ...extra] = copies ?? [];
  if (!running) return null;
  if (extra.length === 0) {
    return (
      <p className="mt-1 truncate text-[9px] text-text-muted" title={running.path}>
        {describe(running)} · {running.path}
      </p>
    );
  }
  return (
    <div className="mt-1.5 flex flex-col gap-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[10px]">
      <span className="font-medium text-amber-400">
        {copies?.length} installs on PATH: the first one runs, and an update may land in another
      </span>
      <div className="min-w-0">
        <span className="text-text-primary">Runs: {describe(running)}</span>
        <p className="truncate font-mono text-[9px] text-text-muted" title={running.path}>
          {running.path}
        </p>
      </div>
      {extra.map((c) => (
        <div key={c.path} className="min-w-0">
          <span className="text-text-secondary">Not used: {describe(c)}</span>
          <p className="truncate font-mono text-[9px] text-text-muted" title={c.path}>
            {c.path}
          </p>
          <CopyCommand label="Remove this copy" command={c.uninstallCommand} />
        </div>
      ))}
    </div>
  );
}
