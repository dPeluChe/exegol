interface Window {
  api: {
    trpc: {
      invoke: (path: string, input: unknown) => Promise<unknown>;
    };
    terminal: {
      onData: (id: string, callback: (data: string) => void) => () => void;
      write: (id: string, data: string) => void;
      resize: (id: string, cols: number, rows: number) => void;
    };
    app: {
      getVersion: () => Promise<string>;
      getPlatform: () => string;
    };
    dialog: {
      showOpenDialog: (
        options: Record<string, unknown>,
      ) => Promise<{ canceled: boolean; filePaths: string[] }>;
    };
    windowControls: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
  };
}
