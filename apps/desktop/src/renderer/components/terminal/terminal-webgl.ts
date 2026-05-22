import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";

export interface WebglController {
  attach: () => void;
  detach: () => void;
  dispose: () => void;
  hasFallenBack: () => boolean;
}

export function createWebglController(terminal: Terminal): WebglController {
  let addon: WebglAddon | null = null;
  let fellBack = false;
  let disposed = false;

  function attach(): void {
    if (disposed || fellBack || addon) return;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        addon = null;
      });
      terminal.loadAddon(webgl);
      addon = webgl;
    } catch {
      fellBack = true;
    }
  }

  function detach(): void {
    addon?.dispose();
    addon = null;
  }

  function dispose(): void {
    disposed = true;
    detach();
  }

  return { attach, detach, dispose, hasFallenBack: () => fellBack };
}
