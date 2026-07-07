# T38 — WebGL Context Pooling

## Inspiration Source
- **Analysis**: Direct observation of xterm.js WebGL addon behavior. Each terminal creates a new WebGL context; browsers limit active contexts to 8-16.
- **Pattern applied**: IntersectionObserver-based visibility detection to load/unload WebGL dynamically

## What Changed
- Modified `renderer/components/terminal/TerminalInstance.tsx`:
  - Added IntersectionObserver to detect terminal viewport visibility
  - WebGL addon loaded only when terminal is visible (enters viewport)
  - WebGL addon disposed when terminal leaves viewport (tab switch, scroll offscreen)
  - Added `webglAddonRef` for lifecycle management
  - Canvas renderer used as fallback when WebGL is disposed or unavailable

## Architecture Decisions
- IntersectionObserver over manual tracking: zero-overhead, browser-native, handles all visibility scenarios (tab switch, split pane scroll, window resize)
- Threshold 0.01: triggers when even 1% of terminal is visible — avoids late WebGL loading
- No global pool counter: simpler than tracking a max count. The browser's own WebGL context limit provides the hard cap.
- Context loss handler preserved: if GPU reclaims context, ref is nulled so re-creation happens on next visibility cycle
- Read-only terminals (stopped agents) also get visibility-based WebGL — avoids wasting GPU on off-screen historical views

## How to Test
1. Open 10+ agent terminals across multiple workspace tabs
2. Switch between tabs — verify no WebGL context errors in console
3. Only visible terminals should have WebGL (check: `document.querySelectorAll('canvas').length`)
4. Tab switching should feel instant (WebGL loads within 1 frame, no visual flicker)
