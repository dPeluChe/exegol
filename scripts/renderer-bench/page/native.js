import { Wraith } from '../node_modules/wraithterm/dist/index.js';
const log = (...a) => console.log(...a);
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seed = 1;
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


function layout(n) {
  const root = document.getElementById('root'); root.innerHTML = '';
  const c = Math.ceil(Math.sqrt(n)), r = Math.ceil(n / c);
  root.style.gridTemplateColumns = `repeat(${c}, 1fr)`; root.style.gridTemplateRows = `repeat(${r}, 1fr)`;
  return Array.from({ length: n }, () => { const d = document.createElement('div'); d.className = 'cell'; root.appendChild(d); return d; });
}
async function run(workload, n, frames) {
  const hosts = layout(n);
  const pool = n > 1 ? Wraith.pool({ workers: 2 }) : undefined;
  const terms = await Promise.all(hosts.map((h) => Wraith.mount(h, { fontSize: 13, scrollback: 10000, ...(pool ? { pool } : {}) })));
  for (let i = 0; i < 10; i++) await raf();
  const { cols, rows } = terms[0];
  const gen = (f) => workload === 'tui' ? tuiFrame(cols, rows, f) : workload === 'rainbow' ? rainbowFrame(cols, rows, f) : streamFrame(f);
  for (let f = 0; f < 30; f++) { await Promise.all(terms.map((t) => t.write(gen(f)))); await raf(); }
  const name = `native ${workload} x${n}`;
  log('MARK start ' + name); await sleep(50);
  const t0 = performance.now(); let js = 0, worst = 0, prev = performance.now();
  for (let f = 30; f < 30 + frames; f++) {
    const a = performance.now(); await Promise.all(terms.map((t) => t.write(gen(f)))); js += performance.now() - a;
    await raf(); const now = performance.now(); worst = Math.max(worst, now - prev); prev = now;
  }
  const wall = performance.now() - t0;
  log('MARK end ' + name + ' ' + JSON.stringify({ name, frames, cols, rows, wallPerFrame: +(wall / frames).toFixed(2), parsePerFrame: +(js / frames).toFixed(2), worstFrame: +worst.toFixed(1), renderers: 'native:' + n }));
  for (const t of terms) await t.dispose();
  pool?.dispose(); await sleep(300);
}
(async () => {
  const plan = JSON.parse(decodeURIComponent(location.hash.slice(1)));
  for (const [, workload, n, frames] of plan) await run(workload, n, frames);
  log('DONE');
})().catch((e) => log('ERROR ' + (e && e.stack || e)));
