/** Opens a URL outside the app. Main's setWindowOpenHandler is the real control: it
 *  denies every window and hands http(s) URLs to the system browser. */
export function openInBrowser(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}
