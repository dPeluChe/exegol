import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LoadingSpinner } from "./components/common";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/globals.css";

// T84: floating pane windows render a minimal UI (not the full app shell).
// T120: settings window mounts a standalone <SettingsRoot/>.
// Check the URL before deciding what to mount.
const searchParams = new URLSearchParams(window.location.search);
const isFloatingWindow = searchParams.has("floatingPane");
const isSettingsWindow = searchParams.has("settings");
const FloatingPaneRoot = lazy(() =>
  import("./FloatingPaneRoot").then((m) => ({ default: m.FloatingPaneRoot })),
);
const SettingsRoot = lazy(() =>
  import("./SettingsRoot").then((m) => ({ default: m.SettingsRoot })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {isFloatingWindow ? (
          <Suspense fallback={null}>
            <FloatingPaneRoot />
          </Suspense>
        ) : isSettingsWindow ? (
          <Suspense fallback={<LoadingSpinner className="h-screen w-screen" />}>
            <SettingsRoot />
          </Suspense>
        ) : (
          <App />
        )}
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

// Dismiss splash screen immediately for floating windows (they're small and
// don't need the brand intro). For the main window, honor the minimum time.
const SPLASH_MIN_MS = isFloatingWindow || isSettingsWindow ? 0 : 2000;
const splashStart = performance.now();

requestAnimationFrame(() => {
  const splash = document.getElementById("splash");
  if (!splash) return;

  const elapsed = performance.now() - splashStart;
  const remaining = Math.max(0, SPLASH_MIN_MS - elapsed);

  setTimeout(() => {
    splash.style.transition = "opacity 0.4s ease";
    splash.style.opacity = "0";
    setTimeout(() => splash.remove(), 400);
  }, remaining);
});
