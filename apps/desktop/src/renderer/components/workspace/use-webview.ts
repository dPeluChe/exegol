import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useLatest } from "../../hooks/use-latest";

type WebviewRef = React.RefObject<HTMLElement | null>;

export type LoadError = { code: number; desc: string };

/** Back / forward / reload / DevTools on an Electron webview (not in the TS DOM types) */
export function useWebviewControls(webviewRef: WebviewRef) {
  const handleBack = useCallback(() => {
    const wv = webviewRef.current as unknown as { goBack?: () => void } | null;
    wv?.goBack?.();
  }, [webviewRef]);
  const handleForward = useCallback(() => {
    const wv = webviewRef.current as unknown as { goForward?: () => void } | null;
    wv?.goForward?.();
  }, [webviewRef]);
  const handleReload = useCallback(() => {
    const wv = webviewRef.current as unknown as { reload?: () => void } | null;
    wv?.reload?.();
  }, [webviewRef]);
  const handleOpenDevTools = useCallback(() => {
    const wv = webviewRef.current as unknown as {
      isDevToolsOpened?: () => boolean;
      openDevTools?: () => void;
      closeDevTools?: () => void;
    } | null;
    if (wv?.isDevToolsOpened?.()) wv.closeDevTools?.();
    else wv?.openDevTools?.();
  }, [webviewRef]);
  return { handleBack, handleForward, handleReload, handleOpenDevTools };
}

/** The webview's page URL, loading flag, back/forward availability and main-frame load failure */
export function useWebviewNavState(
  webviewRef: WebviewRef,
  initialUrl: string,
  onFinishLoad?: React.MutableRefObject<() => void>,
  /** Every page it lands on (links, redirects, in-page routes), to keep it across remounts */
  onPage?: (url: string) => void,
) {
  const onPageRef = useLatest(onPage);
  const [pageUrl, setPageUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const webview = webviewRef.current as unknown as {
      addEventListener: (e: string, fn: (ev: Event) => void) => void;
      removeEventListener: (e: string, fn: (ev: Event) => void) => void;
      canGoBack: () => boolean;
      canGoForward: () => boolean;
    } | null;
    if (!webview) return;
    const updateHistory = () => {
      try {
        setCanGoBack(webview.canGoBack());
        setCanGoForward(webview.canGoForward());
      } catch {
        /* webview not ready */
      }
    };
    const onNavigate = (ev: Event) => {
      const url = (ev as unknown as { url?: string }).url;
      if (url) {
        setPageUrl(url);
        onPageRef.current?.(url);
      }
      updateHistory();
    };
    const onFailLoad = (ev: Event) => {
      const e = ev as unknown as {
        errorCode: number;
        errorDescription: string;
        isMainFrame: boolean;
      };
      if (e.isMainFrame) {
        setLoadError({ code: e.errorCode, desc: e.errorDescription });
        // The server may be gone: re-detect now instead of on the next poll
        queryClient.invalidateQueries({ queryKey: ["resources", "ports"] });
      }
    };
    const onStartLoading = () => {
      setLoading(true);
      setLoadError(null);
    };
    const onStopLoading = () => {
      setLoading(false);
      updateHistory();
    };
    const onFinishLoadEvent = () => {
      updateHistory();
      onFinishLoad?.current();
    };
    const listeners: [string, (ev: Event) => void][] = [
      ["did-navigate", onNavigate],
      ["did-navigate-in-page", onNavigate],
      ["did-finish-load", onFinishLoadEvent],
      ["did-fail-load", onFailLoad],
      ["did-start-loading", onStartLoading],
      ["did-stop-loading", onStopLoading],
    ];
    for (const [event, fn] of listeners) webview.addEventListener(event, fn);
    return () => {
      for (const [event, fn] of listeners) webview.removeEventListener(event, fn);
    };
  }, [queryClient, onFinishLoad, webviewRef, onPageRef]);

  return { pageUrl, loading, canGoBack, canGoForward, loadError };
}
