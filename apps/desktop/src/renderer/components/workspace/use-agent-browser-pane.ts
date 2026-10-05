import { useEffect } from "react";
import { webviewIdOf } from "./use-browser-qa";

/** Offer this pane's webview to its project's agents. Main checks the webview really is in that
 *  project's partition before an agent can reach it */
export function useAgentBrowserPane(
  webviewRef: React.RefObject<HTMLElement | null>,
  paneId: string | null,
  projectId: string | null | undefined,
): void {
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !paneId || !projectId) return;
    const register = () => {
      let id: number | undefined;
      try {
        id = webviewIdOf(webviewRef);
      } catch {
        return; // not attached yet: dom-ready registers it
      }
      if (id !== undefined)
        void window.api.browser.registerPane(paneId, projectId, id).catch(() => {});
    };
    register();
    wv.addEventListener("dom-ready", register);
    return () => wv.removeEventListener("dom-ready", register);
  }, [webviewRef, paneId, projectId]);
}
