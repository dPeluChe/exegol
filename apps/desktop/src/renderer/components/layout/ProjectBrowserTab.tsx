import type { SitePermissionRow } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { toastError } from "../../stores/toasts";

/** Hosts and eval are drafts the dialog's Save commits */
export function ProjectBrowserTab({
  projectId,
  hosts,
  onHosts,
  allowEval,
  onAllowEval,
}: {
  projectId: string;
  hosts: string;
  onHosts: (hosts: string) => void;
  allowEval: boolean;
  onAllowEval: (on: boolean) => void;
}) {
  return (
    <>
      <label className="mb-3 block">
        <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-muted">
          Agent browser hosts
        </span>
        <textarea
          value={hosts}
          onChange={(e) => onHosts(e.target.value)}
          rows={3}
          placeholder={"staging.myapp.com\n*.myapp.dev"}
          className="w-full min-w-0 resize-y rounded border border-border bg-bg-tertiary px-2 py-1 font-mono text-[11px] text-text-primary outline-none focus:border-accent/50"
        />
        <span className="mt-1 block text-[10px] text-text-muted">
          Besides local hosts (localhost, 127.0.0.1, *.localhost), the sites this project's agents
          may open in its browser pane. One per line; *.domain covers its subdomains; .local names
          go here too. Your logins for a host you add are copied in.
        </span>
      </label>

      <label className="mb-3 flex items-start gap-2 text-[11px] text-text-secondary">
        <input
          type="checkbox"
          checked={allowEval}
          onChange={(e) => onAllowEval(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Let agents run JavaScript in the page (browser_eval). It runs with this project's logins;
          while an agent acts, requests outside the hosts above are blocked.
        </span>
      </label>

      <SitePermissions projectId={projectId} />
    </>
  );
}

/** "Always allow" / "Block" answers given in this project's browser panes; removing one makes
 *  the site ask again */
function SitePermissions({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const key = ["projects", "browserPermissions", projectId];
  const { data: rows = [] } = useQuery({
    queryKey: key,
    queryFn: () =>
      trpcInvoke<SitePermissionRow[]>("projects.browserPermissions", { id: projectId }),
  });
  const forget = useMutation({
    mutationFn: (r: SitePermissionRow) =>
      trpcMutate("projects.forgetBrowserPermission", {
        id: projectId,
        origin: r.origin,
        permission: r.permission,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: toastError("Could not forget the site permission"),
  });
  if (rows.length === 0) return null;
  return (
    <div className="mb-3">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-muted">
        Site permissions
      </span>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li
            key={`${r.origin} ${r.permission}`}
            className="flex items-center gap-2 text-[11px] text-text-secondary"
          >
            <span className="min-w-0 flex-1 truncate font-mono" title={r.origin}>
              {r.origin}
            </span>
            <span className="shrink-0">{r.label}</span>
            <span
              className={
                r.decision === "allow" ? "shrink-0 text-green-400" : "shrink-0 text-red-400"
              }
            >
              {r.decision === "allow" ? "Allowed" : "Blocked"}
            </span>
            <button
              type="button"
              aria-label={`Forget ${r.label} for ${r.origin}`}
              title="Forget: the site asks again"
              onClick={() => forget.mutate(r)}
              className="shrink-0 rounded p-0.5 text-text-muted hover:bg-white/10 hover:text-text-primary"
            >
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
