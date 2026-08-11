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
