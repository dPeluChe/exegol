import { nanoid } from "nanoid";
import { create } from "zustand";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ToastType = "info" | "success" | "warning" | "error";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  body?: string;
  agentId?: string;
  createdAt: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (t: Omit<Toast, "id" | "createdAt">) => void;
  removeToast: (id: string) => void;
}

// T155.7: auto-dismiss timing is owned by ToastStack (per-toast timer with
// hover-pause), not the store — the store only holds the queue.
export const TOAST_AUTO_DISMISS_MS = 5_000;
const MAX_TOASTS = 10;

// ─── Store ──────────────────────────────────────────────────────────────────

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (t) => {
    const toast: Toast = { ...t, id: nanoid(8), createdAt: Date.now() };
    set((state) => ({
      toasts: [toast, ...state.toasts].slice(0, MAX_TOASTS),
    }));
  },

  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((x) => x.id !== id) }));
  },
}));
