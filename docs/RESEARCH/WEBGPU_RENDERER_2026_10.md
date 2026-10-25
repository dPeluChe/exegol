# WebGPU terminal renderer, October 2026

Question: would drawing terminals with WebGPU instead of WebGL (`@xterm/addon-webgl`) make
Exegol faster, and is there anything we can take now? Trigger:
[wraithterm](https://github.com/betterclever/wraithterm) (MIT, first commit 2026-10-10,
`wraithterm@0.5.0` on npm 2026-10-25), which claims 3.9x less CPU than xterm.js + WebGL.

Short answer: not today. On Exegol-like output its xterm-compatible WebGPU renderer costs 3-5x
**more** CPU than addon-webgl. The benchmark did find one case where addon-webgl collapses
(truecolors that never repeat: 350 ms a frame), and this PR ships a guard for it.

## What Wraith is

Two profiles in one package:

- `wraithterm/xterm`: the real `@xterm/xterm@6.0.0` (aliased as `@wraith-terminal/xterm-base`)
  with its renderer swapped through private internals (`_renderService._renderer.clearAndLeak()`
  then `setRenderer`). Rows are packed in JS into 20-byte cells in Wasm memory; a Rust/wgpu
  compositor in a 2.7 MB Wasm module draws them in two instanced draws on the main thread. Glyphs
  are rasterized by Canvas2D once per glyph and style, **not per color**: color is applied in the
  shader. It also patches xterm's parser per instance (SGR fast path, bulk print of ASCII runs).
  Falls back to xterm's DOM renderer (not WebGL) when WebGPU is missing, the device is lost, the
  atlas fills, or a character joiner is registered. A lost device stays on DOM for that terminal.
- `Wraith.mount()` ("native"): Ghostty's `libghostty-vt` parses and renders in a worker
  (OffscreenCanvas), one WebGPU device shared per worker (`Wraith.pool()`). Its own API, not
  xterm's: no Serialize addon, no xterm buffer, link providers, parser hooks or our OSC handlers.

Their headline numbers (2.5 ms vs 9.8 ms) are for a dense update whose styles change every frame,
measured mostly on the native path; their docs say the native results "do not measure" the xterm
profile.

## Method

`scripts/renderer-bench/` (reproduce from its README). Electron 41.0.2 (the Chromium Exegol
ships), Apple M-series, Metal, window 1280x820 at a 120 Hz display, Menlo 13 px, Unicode11 on as
in Exegol. Per run: 30 warm-up frames, then 240 frames of write + one animation frame. Measured
from `app.getAppMetrics()` CPU time: renderer process (main thread, workers, Wasm) and GPU process,
per frame. Two interleaved rounds (order reversed in the second), averages below; rounds agreed
within ~10%.

Workloads: `tui` full-screen repaint with a fixed 6-color truecolor palette (a CLI redrawing its
screen), `stream` 40 colored log lines a frame, `spinner` one cell a frame, `shimmer` a 50-char
gradient status line, `rainbow` the `tui` screen with truecolors that never repeat (lolcat,
gradients, btop graphs, image-to-ANSI), `mixed` one `rainbow` terminal beside five `tui` ones.

## Results

CPU ms per frame, renderer + GPU process. Wall is ms per frame (8.3 = every 120 Hz frame made).

| Workload | DOM | addon-webgl | Wraith xterm (WebGPU) | Wraith native |
|---|---|---|---|---|
| tui, 1 terminal 163x52 | 18.4 + 2.8 | **3.0 + 1.2** | 13.9 + 2.1 (wall 16.1) | 2.7 + 2.2 (160x44) |
| stream, 1 terminal | 6.2 + 1.4 | **2.0 + 1.1** | 10.2 + 1.5 | 1.6 + 2.1 |
| spinner, 1 terminal | 1.5 + 1.1 | 1.7 + 1.2 | 1.2 + 2.2 | |
| shimmer, 1 terminal | 2.0 + 1.0 | 1.7 + 1.7 | 1.4 + 2.2 | |
| tui, 6 terminals | 18.0 + 2.9 | **3.2 + 2.8** | 14.3 + 4.3 | 4.3 + 4.0 |
| stream, 6 terminals | 15.3 + 2.2 | **3.5 + 2.4** | 12.5 + 3.8 | 3.3 + 3.9 |
| 20 terminals, 1 active | 2.7 + 0.8 | 1.4 + 0.3 | 2.6 + 1.5 | |
| **rainbow, 1 terminal** | 24.5 + 3.6 | **352 + 155 (wall 141)** | 16.9 + 2.6 | 2.9 + 2.1 |

With Unicode11 off (Wraith's bulk print path on) the xterm profile is the same: tui 12.3 ms,
stream 9.5 ms. Of a `tui` frame, ~7 ms of Wraith's xterm profile is spent inside `write` (1.2 ms
with addon-webgl); it misses the 120 Hz frame on one terminal.

## Findings

1. **addon-webgl is the fastest xterm renderer for normal agent output.** 3-5x less renderer CPU
   than Wraith's xterm profile, ~6x less than DOM. Swapping renderers would make Exegol slower.
2. **Wraith native is on par with addon-webgl in CPU, but off the main thread.** Its win is
   architecture (parse and draw in a worker), not raw speed. It cannot replace xterm in Exegol
   without rewriting the terminal stack: snapshots (Serialize), link providers, OSC handlers,
   mirrors, `terminal-buffer`, Send to, TUI copy all sit on the xterm API.
3. **addon-webgl collapses on colors that never repeat.** Its atlas keys each glyph by
   (characters, bg, fg, attributes) (`getRasterizedGlyph(chars, bg, fg, ext)` in 0.19), so every
   new truecolor is a new Canvas2D rasterization plus a texture upload: 441 atlas pages made and
   440 merged away in 120 frames, 7 fps, a core pinned. DOM is 14x cheaper there and Wraith's
   color-independent atlas 20x. On the shared atlas (every view with the same font and theme
   uses one) the damage spreads: one rainbow terminal beside five normal ones took **32 ms + 30 ms
   a frame for all six** (wall 21.8 ms, frames dropped in every pane) against 3.2 + 2.8 without it.
   The other workloads made 0-2 pages in total.
4. **WebGPU contexts have no 16-per-renderer cap** (20 terminals drew fine), the limit we work
   around with park/evict (`webgl-budget.ts`). Not worth a renderer swap by itself.
5. **Platforms.** WebGPU in Electron 41: on in macOS (Metal, verified here) and Windows (D3D12,
   not verified); Linux depends on GPU and driver (Vulkan) and may be off. Wraith then falls back
   to DOM, the slowest renderer, so any adoption would need our own fallback to WebGL.

## Options

| Option | Gain | Effort | Verdict |
|---|---|---|---|
| A. `wraithterm/xterm` as the renderer | negative today (3-5x CPU) | S to try, M to ship | No. Revisit if a release measures better on `tui`/`stream` |
| B. Wraith native in a worker | main thread free, same CPU | L (terminal stack rewrite) | No |
| C. Our own WebGPU or WebGL renderer with a color-independent atlas | fixes finding 3 at the root | L | Not now; upstream xterm is the better place |
| D. Guard: a view churning the atlas goes to DOM for a while | 32 to 10 ms in `mixed`, 350 to 25 ms in `rainbow` | S | **Shipped in this PR** |
| E. Upstream issue on addon-webgl: tint glyphs in the shader | fixes it for everyone | S to file | Follow-up |

## The guard (option D)

`renderer/components/terminal/atlas-churn.ts` + `terminal-webgl.ts`:

- Every addon forwards the shared atlas's `onAddTextureAtlasCanvas`; pages are counted once per
  canvas (a `WeakSet`), and claimed by the first view whose `onRender` fires next. xterm fires
  `onRender` synchronously right after that view's `renderRows`, where pages are made, so the view
  that drew them is the one that claims them.
- 16 pages within 2 s (normal output: 0-2 in total) trips the view: its addon is dropped (the
  DOM renderer, refit) for 30 s, then WebGL comes back. A repeat within 10 min: 2 min, then 10.
  Only that view leaves WebGL; a GPU crash repaint meanwhile does not bring it back early.
- Main logs `[TermMount] <id> glyph atlas churn: N pages in Xms, DOM renderer for Ns` (WARN),
  counts only.

Measured with Exegol's real controller and addon-webgl 0.19 (`exegol` mode):

| Workload | addon-webgl | with the guard | Tripped |
|---|---|---|---|
| tui x6, stream, shimmer | 3.2 / 2.0 / 1.7 ms | 3.2 / 2.7 / 2.0 ms | never |
| mixed (1 rainbow + 5 tui) | 32.2 + 30.3 ms, wall 21.8 | **10.1 + 3.6 ms, wall 8.3** | the rainbow view, after 576 ms |
| rainbow x1 | 325 + 130 ms, wall 116 | **24.8 + 3.7 ms, wall 17.3** | after 458 ms |

Each return to WebGL while the output is still churning costs ~0.5 s of slow frames before it
trips again.

## Follow-ups

- File the addon-webgl issue (option E) with the `rainbow` repro.
- Re-run `scripts/renderer-bench` on new Wraith releases and on Windows/Linux hardware.
- Wraith's parser patches (SGR fast path, bulk ASCII print) could speed main's `HeadlessEmulator`
  (`@xterm/headless` parses every byte of every session). They reach into xterm internals and are
  not exported by the package; measure before considering it.
