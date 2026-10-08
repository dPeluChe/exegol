import { cn } from "@exegol/ui";
import { AlertTriangle, CheckCircle, Info, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { switchSection } from "../../lib/switch-section";
import type { Toast, ToastType } from "../../stores/toasts";
import { TOAST_AUTO_DISMISS_MS, useToastStore } from "../../stores/toasts";

// ─── Toast visual config ────────────────────────────────────────────────────

const TOAST_CONFIG: Record<
  ToastType,
  { icon: typeof CheckCircle; barClass: string; iconClass: string }
> = {
  success: {
    icon: CheckCircle,
    barClass: "bg-success",
    iconClass: "text-success",
  },
  error: {
    icon: XCircle,
    barClass: "bg-error",
    iconClass: "text-error",
  },
  warning: {
    icon: AlertTriangle,
    barClass: "bg-warning",
    iconClass: "text-warning",
  },
  info: {
    icon: Info,
    barClass: "bg-info",
    iconClass: "text-info",
  },
};

const MAX_VISIBLE = 3;

// ─── Component ──────────────────────────────────────────────────────────────

export function ToastStack() {
  const toasts = useToastStore((s) => s.toasts);

  const visible = toasts.slice(0, MAX_VISIBLE);

  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-10 z-50 flex flex-col gap-2">
      {visible.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const [hovered, setHovered] = useState(false);

  // T155.7: hover pauses auto-dismiss; leaving restarts the FULL duration
  // (the effect re-runs with a fresh timer when `hovered` flips back).
  useEffect(() => {
    if (hovered) return;
    const timer = setTimeout(
      () => removeToast(toast.id),
      toast.durationMs ?? TOAST_AUTO_DISMISS_MS,
    );
    return () => clearTimeout(timer);
  }, [hovered, toast.id, toast.durationMs, removeToast]);

  const config = TOAST_CONFIG[toast.type];
  const Icon = config.icon;

  return (
    <div
      role="status"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "pointer-events-auto relative flex w-72 animate-toast-in overflow-hidden rounded-lg border border-border bg-bg-secondary text-left shadow-lg",
      )}
    >
      <button
        type="button"
        className="flex flex-1 text-left"
        onClick={() => {
          if (toast.agentId) {
            switchSection("agents");
          }
          removeToast(toast.id);
        }}
      >
        {/* Color bar */}
        <div className={cn("w-1 shrink-0", config.barClass)} />

        {/* Content */}
        <div className="flex flex-1 items-start gap-2 py-2.5 pr-[34px] pl-3">
          <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", config.iconClass)} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-text-primary">{toast.title}</p>
            {toast.body && (
              <p className="mt-0.5 truncate text-[11px] text-text-muted">{toast.body}</p>
            )}
          </div>
        </div>
      </button>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.run();
            removeToast(toast.id);
          }}
          className="mr-8 self-center rounded px-2 py-1 text-xs font-semibold text-accent hover:bg-bg-tertiary"
        >
          {toast.action.label}
        </button>
      )}
      {/* T155.7: X-dismiss only removes the toast — it never marks the
          related attention item read (that's pane activation / inbox click). */}
      <button
        type="button"
        onClick={() => removeToast(toast.id)}
        aria-label="Dismiss"
        className="absolute top-3 right-3 text-text-muted hover:text-text-secondary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
