import { cn } from "@exegol/ui";
import { ShieldQuestion, X } from "lucide-react";
import { useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useToastStore } from "../../stores/toasts";

interface PermissionRequest {
  id: string;
  paneId: string;
  host: string;
  /** "use your location", "show notifications"... */
  what: string;
}

type Answer = "once" | "always" | "block" | "deny";

const btn =
  "shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/10";

function usePermissionRequests(paneId: string) {
  const [requests, setRequests] = useState<PermissionRequest[]>([]);
  // A pane keeps its id while mounted
  useMountEffect(() => {
    const offRequest = window.api.browser.onPermissionRequest((r) => {
      if (r.paneId === paneId) setRequests((list) => [...list, r]);
    });
    const offClosed = window.api.browser.onPermissionClosed(({ id }) =>
      setRequests((list) => list.filter((r) => r.id !== id)),
    );
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
  const answer = (id: string, a: Answer) => {
    setRequests((list) => list.filter((r) => r.id !== id));
    void window.api.browser.answerPermission(id, a).catch(() => {});
  };
  return { request: requests[0] ?? null, answer };
}

/** A pane's page asks for a site permission. The page waits for the answer, as in Chrome; Esc
 *  or the close button deny this request only. No autofocus: it must not take the terminal's keys */
export function PagePermissionBar({ paneId }: { paneId: string }) {
  const { request, answer } = usePermissionRequests(paneId);
  if (!request) return null;
  const reply = (a: Answer) => answer(request.id, a);
  return (
    <div
      role="alertdialog"
      aria-label={`${request.host || "This page"} wants to ${request.what}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") reply("deny");
      }}
      className="flex shrink-0 items-center gap-2 border-b border-accent/30 bg-accent/10 px-2 py-1.5 text-[11px] text-text-secondary"
    >
      <ShieldQuestion className="h-3 w-3 shrink-0 text-accent" />
      <div className="min-w-0 flex-1 truncate">
        <span className="font-medium text-text-primary">{request.host || "This page"}</span> wants
        to {request.what}
      </div>
      <button type="button" className={cn(btn, "border-border")} onClick={() => reply("block")}>
        Block
      </button>
      <button type="button" className={cn(btn, "border-border")} onClick={() => reply("always")}>
        Always allow on this site
      </button>
      <button
        type="button"
        className={cn(btn, "border-accent/40 text-accent")}
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
