import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@main": resolve("src/main"),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "pty-subprocess": resolve("src/main/terminal/pty-subprocess.ts"),
          "pty-sidecar-entry": resolve("src/main/terminal/pty-sidecar-entry.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer"),
        "@exegol/shared": resolve("../../packages/shared/src"),
        "@exegol/ui": resolve("../../packages/ui/src"),
      },
    },
  },
});
