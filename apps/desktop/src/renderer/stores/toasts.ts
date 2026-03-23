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

// ─── Auto-dismiss timer refs ────────────────────────────────────────────────

const timerMap = new Map<string, ReturnType<typeof setTimeout>>();

const AUTO_DISMISS_MS = 5_000;
const MAX_TOASTS = 10;

// ─── Store ──────────────────────────────────────────────────────────────────

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (t) => {
    const id = nanoid(8);
    const toast: Toast = { ...t, id, createdAt: Date.now() };

    set((state) => ({
      toasts: [toast, ...state.toasts].slice(0, MAX_TOASTS),
    }));

    // Auto-dismiss after timeout
    const timer = setTimeout(() => {
      timerMap.delete(id);
      set((state) => ({ toasts: state.toasts.filter((x) => x.id !== id) }));
    }, AUTO_DISMISS_MS);

    timerMap.set(id, timer);
  },

  removeToast: (id) => {
    // Clear auto-dismiss timer if user manually dismisses
    const timer = timerMap.get(id);
    if (timer) {
      clearTimeout(timer);
      timerMap.delete(id);
    }

    set((state) => ({ toasts: state.toasts.filter((x) => x.id !== id) }));
  },
}));
