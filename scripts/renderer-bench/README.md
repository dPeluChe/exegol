# Renderer benchmark

Measures renderer-process and GPU-process CPU per frame in Electron's own Chromium for each
terminal renderer. Method, results and conclusions: `docs/RESEARCH/WEBGPU_RENDERER_2026_10.md`.

```bash
cd scripts/renderer-bench
npm install --ignore-scripts && npm run build
E=$(node -p "require('../../apps/desktop/node_modules/electron')" 2>/dev/null || node -p "require('../../node_modules/electron')")
PLAN='[["webgl","tui",1,240],["exegol","mixed",6,240]]' "$E" main.cjs
PAGE=page/native.html PLAN='[["native","tui",1,240]]' "$E" main.cjs
```

`PLAN` is a list of `[mode, workload, terminals, frames]`. Modes: `dom`, `webgl` (addon-webgl),
`exegol` (addon-webgl through `terminal-webgl.ts`, with the atlas churn guard), `guard` (the
first terminal on DOM, the rest WebGL), `webgpu` (`wraithterm/xterm`), suffix `-u6` skips
Unicode11. Workloads: `tui` (full-screen repaint, fixed palette), `stream` (40 log lines a frame),
`spinner`, `shimmer`, `rainbow` (truecolors that never repeat), `mixed` (one rainbow, the rest
tui), `many-idle`. `native.html` runs Wraith's Ghostty worker (`Wraith.mount`), `tui`, `stream`
and `rainbow` only. Each result is one JSON line. The window opens without focus; keep it on screen.
