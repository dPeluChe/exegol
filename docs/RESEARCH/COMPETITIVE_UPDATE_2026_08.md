# Competitive Update — 2026-08-11

Delta desde `COMPETITIVE_REVIEW_2026_07` + audit addendum. Feeds **T156** y **T157**.

## Los 5 hechos que cambian el mapa

1. **Claude Code absorbió tres pilares nuestros de un golpe**: (a) **agent view** (`claude agents`,
   research preview) — dashboard global de TODAS las sesiones cross-project con daemon
   supervisor que las mantiene vivas al cerrar la terminal (= nuestro sidecar + la vista que
   queremos); (b) **cross-session messaging** (v2.1.224+) — dos sesiones independientes se
   mensajean; (c) agent teams madurando (mailbox hardening, plan-approval, hooks de calidad).
2. **Conductor monetizó y se fue a cloud**: Free local / Pro $50/mo (sandboxes cloud que
   siguen corriendo con la app cerrada, API programática, multiplayer alpha, teams $60).
   Ya no es "app gratis de Mac" — construye plataforma.
3. **herdr** (herdr.dev, Rust, single-binary ~10MB, 1 dev, 27.5k ⭐ en ~4 meses): multiplexor
   terminal para agentes — server dueño de PTYs (sobreviven restart), detección de estado
   (working/blocked/idle/done), sidebar cross-workspace, y mensajería agente↔agente "zero-MCP".
   Compite en NUESTRO terreno pero terminal-nativo. Licencia ambigua (README Apache 2.0 vs
   reviews AGPL — posible cambio reciente).
4. **Codex app**: multi-agente más estable pero **sin peer messaging** — la carrera de
   inter-agent comms es Anthropic vs herdr. **Ventana abierta para una implementación
   cross-provider** (nadie la tiene).
5. Consolidación: SpaceX/Cursor cierra Q3; Cursor acqui-hired y mató a Continue. La
   neutralidad cross-provider vale más cada mes.

## herdr — cómo funciona su inter-agent chat (la versión honesta)

No es protocolo de mensajes: son **primitivas PTY** por Unix socket (JSON-RPC) + CLI + un
"skill" que le enseña al agente a usarlas. `agent.list` (descubrir + estados),
`pane.send_text` (el "mensaje" es texto tecleado en el PTY del otro — llega como si el humano
lo escribiera), `agent.prompt` con `wait.until=blocked` (enviar y esperar), `events.subscribe`,
`pane.read` (leer output ajeno). **Debilidad grave**: cero identidad — el receptor no sabe
que el texto vino de un agente y no del humano. Sin política de entrada, sin atribución.

## Claude Code cross-session/teams — el diseño de confianza a copiar

- **Entrega en tool-call boundaries**: nunca interrumpe un tool corriendo; sesión idle →
  turno nuevo. (Nosotros: el FSM T123 nos da exactamente esos boundaries.)
- **Inbox socket por sesión + registry en disco** para discovery; path expuesto por env var
  (espejo de nuestro patrón `EXEGOL_MCP_TOKEN`).
- **Política de entrada por sesión** `accept/hold/refuse`; default asimétrico: mensajes DESDE
  sesiones bypass-permissions se retienen para aprobación humana. Throttling anti-loop
  (dedup + cap 50).
- **Atribución + regla de no-autoridad**: el receptor siempre sabe que vino de otro agente y
  que "no puede aprobar nada". En modo auto, un clasificador revisa cada mensaje inter-agente.
- Teams: mailbox JSON por agente, addressing por nombre, task list compartida con **file
  locking al reclamar** y auto-unblock de dependencias.

## Agent view (dashboard global) — la UX benchmark

Filas agrupadas por estado (Pinned / Ready for review / Needs input / Working / Completed) con
chip de PR; **Space = peek**: ver la pregunta bloqueante y responderla inline (números eligen
opción) sin attachear; Enter attach / ← detach; dispatch desde el dashboard con `@agent` y
`!shell`; Ctrl+S alterna agrupar por estado vs directorio. Daemon supervisor detrás.

## Sin novedad relevante

Nimbalyst (releases incrementales), omnara (mismo pitch), mux (v0.26.x estable), Warp.
No confirmados (solo agregadores): Meta "Muse Code", Microsoft "Project Perception", Block "Buzz".

## Implicación estratégica

La amenaza #1 (absorción first-party) se materializó sobre nuestro terreno exacto — pero
**solo dentro del ecosistema Claude**. Nuestro contragolpe natural: T156 (dashboard global
cross-provider con peek) + T157 (mensajería inter-agente cross-provider con el modelo de
confianza de Anthropic que a herdr le falta). Los tres primitivos ya existen en Exegol:
store cross-project + jumpToAttentionItem (T141), tabla messages (T25, huérfana), MCP server
con tokens por agente (T145), turn boundaries deterministas (T123).

## Moved from TASK_TODO (2026-10-04)

Findings and verdicts from T184 (fx, eve, pullfrog, openchamber, clay; filed 2026-08-22) and
T183 (monocode, mcp_agent_mail_rust, proliferate; filed 2026-08-19). They are research, not
pending work, so the 2026-10-04 backlog audit moved them here verbatim.

### From T184: observability (clay)

14. **The state we scrape for is a first-class variable inside these CLIs and is never emitted.**
    clay has `CLAY_APP_PROMPTING` with a state-change hook, and its own comment says the opaque slot
    is "for the driver (the main loop today, an agent daemon later)". Confirms T123's hook approach is
    the right shape and that scraping is what is left when a CLI exposes nothing.

### From T184: permissions, refuted claims, not worth copying

**Permissions (fx).** Their model is worth adopting as a FRAMING: read/list/glob/search need no
approval, only state-changing calls do, and an approval grants exactly the scope shown rather than a
category. Our access modes are a sentence in the prompt plus an env var — not a gate. The T175 claim
guard is the only thing that actually intercepts, and only for claude-code.

**Refuted — recorded so nobody re-files them:**
- *"History expansion breaks the spawn"*: measured on a real PTY with histexpand confirmed active
  (control: `echo !e` expanded). `!`, `!important` and `!!` inside our quoted heredoc all pass, because
  bash history-expands only the FIRST line of a command and our prompt text is always a continuation
  line. Bracketed paste is on and we do not wrap the payload — fragile, not broken.
- *"Spawn context is rebuilt uncached every spawn"*: the expensive part already is cached —
  `skills/loader.ts:49` memoizes the per-skill `execSync` binary checks with a TTL. File reads and the
  MCP tool context are rebuilt, which is cheap.

**Explicitly NOT worth copying:** pullfrog's Linux/CI-only namespace sandbox (wrong threat model —
our agent runs as the user on the user's machine) and its bot-identity commit authorship (T142 already
ruled that out; single human identity keeps CODEOWNERS working); openchamber's five-surface matrix,
12-locale i18n, client-side multi-run, and in-process server (our sidecar is why terminals survive a
reload); clay's NULL-absorbing JSON accessors and first-word command allowlist.

### From T183: not worth copying

**Explicitly NOT worth copying:**
- Their sender authentication is OFF by default and identity is a tmux-pane file with three legacy
  fallbacks — a symptom of not owning the process. We mint a token at spawn and revoke on exit.
- proliferate's workflow triggers: the README claims "recurring and event-driven" and there are NO
  automated triggers of any kind — no cron, no webhook, no schedule column. Our `scheduler/engine.ts`
  is ahead of them on this axis.
- proliferate's intra-workspace concurrency: two in-process locks, no per-file arbitration at all.
  Our path claims are the differentiated thing here — keep them.
- 900k LOC for a mailbox, with a live Bayes-risk policy that can release other agents' reservations
  on by default. Take the deadlock detector (Tarjan SCC over the conflict graph, surfaced as an
  advisory notification), leave the rest.
