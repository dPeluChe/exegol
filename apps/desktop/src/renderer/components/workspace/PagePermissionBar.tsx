import type { PermissionAnswer } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ShieldQuestion, X } from "lucide-react";
import { useToastStore } from "../../stores/toasts";
import { barBtn, usePaneQueue } from "./pane-bar";

interface PermissionRequest {
  id: string;
  paneId: string;
  host: string;
  /** "use your location", "show notifications"... */
  what: string;
}

function usePermissionRequests(paneId: string) {
  const { first, remove } = usePaneQueue<PermissionRequest>(paneId, (add, drop) => {
    const offRequest = window.api.browser.onPermissionRequest(add);
    const offClosed = window.api.browser.onPermissionClosed(({ id }) => drop(id));
    const offNotice = window.api.browser.onPermissionNotice((n) => {
      if (n.paneId !== paneId || n.kind !== "location-off") return;
      useToastStore.getState().addToast({
        type: "warning",
        title: "macOS keeps your location from Exegol",
        body: "Turn Exegol on in System Settings > Privacy & Security > Location Services, then reload the page.",
        durationMs: 12_000,
      });
    });
    return () => {
      offRequest();
      offClosed();
      offNotice();
    };
  });
  const answer = (id: string, a: PermissionAnswer) => {
    remove(id);
    void window.api.browser.answerPermission(id, a).catch(() => {});
  };
  return { request: first, answer };
}

/** A pane's page asks for a site permission. The page waits for the answer, as in Chrome; Esc
 *  or the close button deny this request only. No autofocus: it must not take the terminal's keys */
export function PagePermissionBar({ paneId }: { paneId: string }) {
  const { request, answer } = usePermissionRequests(paneId);
  if (!request) return null;
  const reply = (a: PermissionAnswer) => answer(request.id, a);
  const host = request.host || "This page";
  return (
    <div
      role="alertdialog"
      aria-label={`${host} wants to ${request.what}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") reply("deny");
      }}
      className="flex shrink-0 items-center gap-2 border-b border-accent/30 bg-accent/10 px-2 py-1.5 text-[11px] text-text-secondary"
    >
      <ShieldQuestion className="h-3 w-3 shrink-0 text-accent" />
      <div className="min-w-0 flex-1 truncate">
        <span className="font-medium text-text-primary">{host}</span> wants to {request.what}
      </div>
      <button type="button" className={cn(barBtn, "border-border")} onClick={() => reply("block")}>
        Block
      </button>
      <button type="button" className={cn(barBtn, "border-border")} onClick={() => reply("always")}>
        Always allow on this site
      </button>
      <button
        type="button"
        className={cn(barBtn, "border-accent/40 text-accent")}
        onClick={() => reply("once")}
      >
        Allow once
      </button>
      <button
        type="button"
        aria-label="Deny this time"
        title="Deny this time"
        className="shrink-0 rounded p-0.5 text-text-muted hover:bg-white/10 hover:text-text-primary"
        onClick={() => reply("deny")}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
