import { LogRing } from "./log-ring";
import type { RawSnapshot } from "./page-scripts";
import type { BrowserPaneHandle } from "./tool-guards";

export const page = (over: Partial<RawSnapshot> = {}): RawSnapshot => ({
  url: "http://localhost:3000/",
  title: "Home",
  text: "Welcome",
  elements: [{ ref: "e1.doc1", role: "button", name: "Save", tag: "button" }],
  more: false,
  offscreen: 0,
  nextOffset: null,
  textLength: 7,
  framesSkipped: 0,
  hasPasswordField: false,
  hasCaptcha: false,
  loggedIn: false,
  focusSecret: false,
  mutations: null,
  ...over,
});

export function fakePane(
  paneId: string,
  projectId: string,
  opts: { snapshot?: RawSnapshot; action?: unknown; url?: string } = {},
): BrowserPaneHandle & { scripts: string[]; loaded: string[]; evals: string[] } {
  const scripts: string[] = [];
  const loaded: string[] = [];
  const evals: string[] = [];
  let url = opts.url ?? opts.snapshot?.url ?? "http://localhost:3000/";
  return {
    paneId,
    projectId,
    scripts,
    loaded,
    evals,
    getUrl: () => url,
    getTitle: () => "Home",
    runIsolated: async (code: string) => {
      scripts.push(code);
      if (code.includes("const elements = []") || code.includes("return signals();")) {
        return { ...(opts.snapshot ?? page()), url };
      }
      return opts.action ?? { ok: true };
    },
    runMain: async (code: string) => {
      evals.push(code);
      return 42;
    },
    loadUrl: (u: string) => {
      loaded.push(u);
      url = u;
    },
    awaitLoad: async () => false,
    loadState: () => ({ failure: null, stopped: false }),
    capture: async () => Buffer.from("jpeg"),
    sendKey: () => {},
    moveMouse: () => {},
    history: () => true,
    lastHttpStatus: () => 200,
    logs: new LogRing(),
  };
}
