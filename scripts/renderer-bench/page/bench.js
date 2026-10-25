import { Terminal as XTerm } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal as WTerm } from 'wraithterm/xterm';
import { createWebglController } from '../../../apps/desktop/src/renderer/components/terminal/terminal-webgl.ts';
import { createWebglBudget } from '../../../apps/desktop/src/renderer/components/terminal/webgl-budget.ts';
const trips = [];
const budget = createWebglBudget(12);

const log = (...a) => console.log(...a);
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const writeP = (t, d) => new Promise((r) => t.write(d, r));

let seed = 1;
const atlasEv = { add: 0, remove: 0, change: 0 };
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const words = ['const', 'agent', 'tool_use', 'Read', 'Edit', 'src/main/index.ts', 'diff', '+42', '-7', 'running', 'ok', '✓', '•', '│', 'thinking…'];
const word = () => words[(rnd() * words.length) | 0];

// Full-screen TUI repaint: home + every row rewritten with truecolor runs (Claude/Codex style).
function tuiFrame(cols, rows, f) {
  let s = '\x1b[?2026h\x1b[H';
  for (let y = 0; y < rows; y++) {
    let line = '', w = 0;
    while (w < cols - 12) {
      const t = word();
      const k = words.indexOf(t);
      line += `\x1b[38;2;${PALETTE[k % PALETTE.length]}m${t} `;
      w += t.length + 1;
    }
    s += line + '\x1b[0m\x1b[K' + (y < rows - 1 ? '\r\n' : '');
  }
  return s + '\x1b[?2026l';
}
const PALETTE = ['220;220;220', '130;170;255', '120;220;140', '240;200;100', '250;120;120', '180;140;250'];
// Claude-style shimmer: a status line whose per-character gradient moves every frame.
function shimmerFrame(rows, f) {
  const text = 'Thinking… (esc to interrupt · 12s · ↓ 1.2k tokens)';
  let s = `\x1b7\x1b[${rows - 1};2H`;
  for (let i = 0; i < text.length; i++) { const v = 120 + ((Math.sin((i - f) / 3) + 1) * 60) | 0; s += `\x1b[38;2;${v};${(v * 0.7) | 0};${(v * 0.5) | 0}m${text[i]}`; }
  return s + '\x1b[0m\x1b8';
}
// Rainbow: the same TUI but every run gets a truecolor never seen before (lolcat, gradients, btop graphs).
function rainbowFrame(cols, rows, f) {
  let s = '\x1b[H';
  for (let y = 0; y < rows; y++) { let line = '', w = 0;
    while (w < cols - 12) { const t = word(); line += `\x1b[38;2;${(f * 7 + y * 3) & 255};${(w * 5) & 255};180m${t} `; w += t.length + 1; }
    s += line + '\x1b[0m\x1b[K' + (y < rows - 1 ? '\r\n' : ''); }
  return s;
}
// Log stream: 40 colored lines per frame, scrolling.
function streamFrame(f) {
  let s = '';
  for (let i = 0; i < 40; i++) s += `\x1b[2m${(f * 40 + i).toString().padStart(6)}\x1b[0m \x1b[32m${word()}\x1b[0m ${word()} ${word()} ${word()} \x1b[33m${word()}\x1b[0m ${word()}\r\n`;
  return s;
}
// Spinner/status: one small edit per frame (agent waiting).
function spinnerFrame(rows, f) {
  return `\x1b7\x1b[${rows};2H\x1b[36m${'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[f % 10]}\x1b[0m thinking ${f}s\x1b8`;
}

function make(modeName, host, idx = 0) {
  const u6 = modeName.endsWith('-u6'); const mode = modeName.replace('-u6', '');
  const opts = { fontSize: 13, fontFamily: 'Menlo, monospace', scrollback: 10000, allowProposedApi: true, theme: { background: '#101014' } };
  const t = mode === 'webgpu' ? new WTerm(opts) : new XTerm(opts);
  if (!u6) { t.loadAddon(new Unicode11Addon()); t.unicode.activeVersion = '11'; }
  t.open(host);
  let lost = 0;
  if (mode === 'exegol') {
    const c = createWebglController(t, { onChurn: (trip) => { console.log('TRIP ' + performance.now().toFixed(0) + ' ' + JSON.stringify(trip)); trips.push({ idx, ...trip }); } }, budget);
    c.unpark();
  }
  if (mode === 'webgl' || (mode === 'guard' && idx > 0)) {
    const a = new WebglAddon();
    a.onContextLoss(() => { lost++; });
    a.onAddTextureAtlasCanvas(() => { atlasEv.add++; });
    a.onRemoveTextureAtlasCanvas(() => { atlasEv.remove++; });
    a.onChangeTextureAtlas(() => { atlasEv.change++; });
    t.loadAddon(a);
  }
  return { t, lost: () => lost };
}

function layout(n) {
  const root = document.getElementById('root');
  root.innerHTML = '';
  const c = Math.ceil(Math.sqrt(n)), r = Math.ceil(n / c);
  root.style.gridTemplateColumns = `repeat(${c}, 1fr)`;
  root.style.gridTemplateRows = `repeat(${r}, 1fr)`;
  return Array.from({ length: n }, () => { const d = document.createElement('div'); d.className = 'cell'; root.appendChild(d); return d; });
}

function fit(t, host) {
  const core = t._core, cell = core._renderService.dimensions.css.cell;
  if (!cell.width) return;
  t.resize(Math.max(20, Math.floor(host.clientWidth / cell.width)), Math.max(5, Math.floor(host.clientHeight / cell.height)));
}

async function run(mode, workload, n, frames) {
  const hosts = layout(n);
  const terms = hosts.map((h, i) => make(mode, h, i));
  if (mode.startsWith('webgpu')) for (const { t } of terms) await t.webgpuReady;
  await raf(); await raf();
  terms.forEach(({ t }, i) => fit(t, hosts[i]));
  for (let i = 0; i < 10; i++) await raf();
  const active = workload === 'many-idle' ? terms.slice(0, 1) : terms;
  const { cols, rows } = terms[0].t;
  const gen = (f, i = 0) => workload === 'mixed' ? (i === 0 ? rainbowFrame(cols, rows, f) : tuiFrame(cols, rows, f)) : workload === 'tui' ? tuiFrame(cols, rows, f) : workload === 'rainbow' ? rainbowFrame(cols, rows, f) : workload === 'spinner' ? spinnerFrame(rows, f) : workload === 'shimmer' ? shimmerFrame(rows, f) : streamFrame(f);
  for (let f = 0; f < 30; f++) { await Promise.all(active.map(({ t }, i) => writeP(t, gen(f, i)))); await raf(); }
  const name = `${mode} ${workload} x${n}`;
  Object.assign(atlasEv, { add: 0, remove: 0, change: 0 });
  log('MARK start ' + name + ' at ' + performance.now().toFixed(0));
  await sleep(50);
  const t0 = performance.now();
  let js = 0, worst = 0, prev = performance.now();
  for (let f = 30; f < 30 + frames; f++) {
    const a = performance.now();
    await Promise.all(active.map(({ t }, i) => writeP(t, gen(f, i))));
    js += performance.now() - a;
    await raf();
    const now = performance.now(); worst = Math.max(worst, now - prev); prev = now;
  }
  const wall = performance.now() - t0;
  const states = terms.map(({ t, lost }) => mode.startsWith('webgpu') ? t.renderer : (lost() ? 'lost' : mode));
  const summary = { trips: trips.splice(0), atlas: { ...atlasEv }, name, frames, cols, rows, wallPerFrame: +(wall / frames).toFixed(2), parsePerFrame: +(js / frames).toFixed(2), worstFrame: +worst.toFixed(1),
    renderers: Object.entries(states.reduce((m, s) => ((m[s] = (m[s] || 0) + 1), m), {})).map(([k, v]) => `${k}:${v}`).join(' '),
    fallback: mode.startsWith('webgpu') ? terms.map(({ t }) => t.rendererFallbackReason).filter(Boolean)[0] : undefined };
  log('MARK end ' + name + ' ' + JSON.stringify(summary));
  terms.forEach(({ t }) => t.dispose());
  await sleep(300);
}

(async () => {
  const gpu = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
  log('INFO ' + JSON.stringify({ webgpu: !!navigator.gpu, adapter: gpu ? (gpu.info?.vendor + ' ' + gpu.info?.architecture) : null }));
  const plan = JSON.parse(decodeURIComponent(location.hash.slice(1)));
  for (const [mode, workload, n, frames] of plan) await run(mode, workload, n, frames);
  log('DONE');
})().catch((e) => log('ERROR ' + (e && e.stack || e)));
