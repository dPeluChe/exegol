import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { visualizer } from "rollup-plugin-visualizer";

const ANALYZE = process.env.ANALYZE === "1";

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
          "exegol-mcp-shim-bin": resolve("src/main/mcp/exegol-mcp-shim-bin.ts"),
          "exegol-claim-guard-bin": resolve("src/main/mcp/exegol-claim-guard-bin.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [
      react(),
      tailwindcss(),
      ...(ANALYZE
        ? [
            visualizer({
              filename: "dist/bundle-stats.html",
              open: false,
              gzipSize: true,
              brotliSize: true,
              template: "treemap",
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer"),
        "@exegol/shared": resolve("../../packages/shared/src"),
        "@exegol/ui": resolve("../../packages/ui/src"),
      },
    },
    build: {
      target: "chrome134",
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            // Vite's preload helper lands in the first chunk that uses it: it sat in monaco, so
            // index.js imported (and preloaded) all 8 MB of monaco at startup just to get it.
            // The monaco rule stays: without it Rollup merged monaco into streamdown's lazy mermaid chunk
            if (id.includes("vite/preload-helper") || id.includes("commonjsHelpers"))
              return "runtime";
            if (id.includes("node_modules/@xterm/")) return "xterm";
            if (
              id.includes("node_modules/monaco-editor") ||
              id.includes("node_modules/@monaco-editor/")
            ) {
              return "monaco";
            }
            if (
              id.includes("node_modules/react/") ||
              id.includes("node_modules/react-dom/") ||
              id.includes("node_modules/scheduler/")
            ) {
              return "react-vendor";
            }
            if (id.includes("node_modules/@radix-ui/")) return "radix";
            if (id.includes("node_modules/@trpc/") || id.includes("node_modules/@tanstack/"))
              return "trpc";
            return undefined;
          },
        },
      },
    },
    esbuild: {
      drop: ["debugger"],
      pure: ["console.debug", "console.info", "console.trace"],
    },
  },
});
