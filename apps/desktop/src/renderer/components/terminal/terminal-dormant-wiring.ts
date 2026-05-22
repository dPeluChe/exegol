import type { Terminal } from "@xterm/xterm";

export interface DormantPipe {
  setVisible: (visible: boolean) => void;
  push: (data: string) => void;
  dispose: () => void;
}

export function createDormantPipe(terminal: Terminal, _initiallyVisible: boolean): DormantPipe {
  let disposed = false;
  return {
    setVisible: () => {},
    push: (data) => {
      if (disposed || data.length === 0) return;
      terminal.write(data);
    },
    dispose: () => {
      disposed = true;
    },
  };
}
