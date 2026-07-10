# klaudio-panels (willywg) — análisis UX 2026-07-09

Repo local: `_repos_2_learn/github.com/willywg/klaudio-panels` (Tauri v2 + SolidJS + Rust,
Claude-only, indie, v1.8.0, ~30 releases en 3 meses, MIT) · Feeds **T155**.

**Framing**: filosofía inversa a Exegol — "nunca reimplementar el UI del agente", un shell
delgado alrededor del CLI real. Gap enorme vs Exegol (sin worktrees/pipelines/memoria/costos/
undo/multi-provider/sidecar — sus PTYs mueren con la app). Pero el **pulido por feature es
altísimo**: su valor para nosotros es 100% detalles de interacción diaria.
**Leer directo**: su `CHANGELOG.md` y `PRPs/*.md` — cada entrada es un spec de implementación
con los failure modes ya documentados.

## Ideas a replicar (ranked valor/esfuerzo) → T155

1. **Drag archivo → terminal como `@path`** (`src/lib/os-drop.ts` + `use-internal-drag.ts`):
   desde file tree, Finder o tabs de preview → mención `@rel/path` (sintaxis nativa de Claude),
   rutas externas escapadas absolutas, multi-drop space-joined. Drag interno pointer-based
   (setPointerCapture + ghost pill + elementFromPoint sobre `data-pty-id`) porque NSView
   intercepta HTML5 drags. Cierra el loop ⌘K → preview → drag al agente.
2. **Links clicables en el terminal** (`xterm-file-links.ts`, `xterm-bare-url-links.ts`,
   ~200 líneas): Cmd+click en `src/foo.ts:42` → abre preview en línea; URLs sin esquema
   (`github.com/x`) clicables con allowlist de TLDs (evita falsos positivos `.ts`/`.json`).
3. **Attention → pane exacto** (PRP 018): dot ámbar pulsante en LA tab origen (suprimido si
   el proyecto tiene una sola tab), click en toast/bell aterriza en la tab exacta. Pulse se
   limpia al activar/tipear/cerrar — deliberadamente NO al cambiar de proyecto. Attention
   gana a status color. Ya tenemos las señales (T123/T124) — falta el routing fino.
4. **Bundle QoL de input de terminal** (changelog 0.7.1–1.3.0, cada fix documentado):
   Shift+Enter → `ESC+CR` (newline sin submit en Claude); Cmd+←/→ → Ctrl+A/E; image paste
   (`term.paste(text ?? "")` siempre — el bracketed-paste vacío es la cue para que Claude
   olfatee imágenes del clipboard); `macOptionIsMeta: false` o layouts intl pierden `@ # |`;
   botón flotante scroll-to-bottom que dobla como indicador "output nuevo abajo" + ⌘↓;
   **máximo un SIGWINCH por activación de pane** (múltiples fits corrompen el alt-screen).
5. **Browser de sesiones Claude + resume** (`sessions.rs`, `sessions-list.tsx`): lee
   `~/.claude/projects/*.jsonl` como biblioteca — label = /rename → summary → primer mensaje,
   click = `claude --resume <id>`, sync en vivo por watcher, auto-resume última sesión.
   Read-only, encaja en nuestro launcher/empty pane.
6. **CLI `exegol .` + deep link** (`scripts/klaudio`, `cli_args.rs`, `shell_install.rs`):
   script resuelve path → `open "exegol://open?path=..."` (URL scheme porque `open --args`
   no alcanza una app corriendo); symlink en /usr/local/bin con fallback ~/.local/bin.
7. **Higiene de notificaciones**: hover pausa el toast (timer completo al salir);
   X-dismiss ≠ marcar leído (queda en el bell); kill switches por canal inline en el popover.

## Patrones transversales que valen

- **Disciplina de foco** (PRP 017): "el foco solo lo fija acción explícita del usuario o
  restore de memoria por proyecto; los flips de visibilidad jamás deciden foco".
- **Persistencia por proyecto**: cada ancho/tab/altura de panel keyed por path; clamp puro
  con piso de 360px al centro; auto-hide no destructivo en ventanas angostas (pref intacta).
- **Cmd+T contextual**: foco en shell dock → nueva tab de shell; si no → nueva tab de agente.
- OSC-777 vía protocolo público de warp (observe-only) — paridad con nuestro T123; ventaja:
  cero setup por agente.

## No aplica / ya lo superamos

Sin registry, worktrees, pipelines, memoria, MCP, costos, scoring, oplog, browser pane,
layouts, PiP, onboarding, DB, ni supervivencia de sesión (nuestro sidecar es estrictamente
superior). macOS-only, sin firmar.
