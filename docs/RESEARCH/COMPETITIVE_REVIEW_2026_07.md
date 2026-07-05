# Competitive Review — Julio 2026

Análisis propio cruzando: (a) el review previo de ~60 repos GitHub (patterns), (b) 15 repos locales de `_repos_2_learn` analizados a fondo (emdash, superset, mission-control, agent-orchestrator, overstory, stoneforge, t3code, pi-mono, smux, terax-ai, gitbutler, qmd, memU, openclaw + clones), y (c) research web del panorama 2025-2026 (Conductor, Sculptor, Crystal/Nimbalyst, vibe-kanban, Cursor 2.0/3, Antigravity, Warp, Codex app, Jules, Devin, Factory, Amp, Cline, Kilo).

---

## 1. Lectura del mercado (lo que el review de patterns no veía)

**El nicho "wrapper de worktrees" ya se comoditizó.** Bloop (vibe-kanban) cerró, Crystal está deprecado, Roo Code archivado. Worktrees + paralelismo + diff review + multi-CLI son table stakes — todos los sobrevivientes los tienen. Sobrevivir exige una capa de valor propia.

**Lo que Exegol ya tiene y es raro:**
- Pipelines multi-agente con loop-back review→fix entre providers distintos — **ningún competidor lo tiene**. Es el headline.
- Scoring de agentes con datos reales del repo del usuario — moat de datos, nadie mide esto.
- PTY sidecar que sobrevive reload/crash — la mayoría de rivales Electron mueren con la ventana. Demo-able.
- Memoria persistente + skills + oplog — solo Warp/Codex/Kilo tienen algo comparable, ninguno agnóstico de provider.

**Table stakes que Exegol NO tiene aún (gaps de lanzamiento):**
1. Notificaciones "agente terminó / necesita input" (Warp, Codex, AgentsRoom la tienen; con 5+ agentes es indispensable)
2. Checkpoints/rollback con UX de primera clase (Conductor, Cline, Codex)
3. Detección de estado confiable (hoy: scraping ANSI; competidores: hooks/protocolos)

---

## 2. El hallazgo #1: estado por hooks/OSC, no scraping

Tres proyectos independientes convergieron en lo mismo — señal fuerte:

- **superset**: hooks del CLI (Claude Code `Stop`/`Notification`) pegan a un servidor local → `TerminalAgentBinding` → badges/ringtone "necesita atención" sin polling.
- **terax-ai** (`agent_detect.rs`): FSM byte-level en el PTY que parsea `OSC 777 notify;<app>;<agent>;<event>` emitido por hooks inyectados vía shell init. Estados: Started/Working/Attention/Finished/Exited.
- **emdash**: `hook-server.ts` + `event-enricher` + ACP donde el provider lo soporta.

**Propuesta para Exegol:** al spawnear, inyectar settings de hooks por provider (Claude Code soporta hooks nativos; Codex/Gemini vía wrapper) que emitan un marcador OSC 777 al PTY. El sidecar ya ve todos los bytes — añadir la FSM al `AgentOutputStream` de Rust es natural. El status parser actual queda como fallback para CLIs sin hooks. Esto alimenta: `activityLevel`, notificaciones, transiciones de pipeline (hoy dependen de exit del proceso), y el evaluator loop.

Impacto: convierte la feature más frágil (status heurístico) en determinista. Esfuerzo: medio. **Prioridad máxima.**

---

## 3. Correcciones al review anterior

| Review previo | Veredicto tras esta ronda |
|---|---|
| **agent-undo** (CAS + BLAKE3 + daemon) | **Reemplazar por el modelo GitButler**: snapshots como git trees, no un store paralelo. Misma granularidad, cero infra nueva. Ver §4. |
| **qi** (RRF) | Confirmado, pero la referencia correcta es **qmd** (Tobi Lütke) — fórmula exacta y lecciones de producción. Ver §5. |
| **OpenSkills** (progressive disclosure) | Confirmado por **openclaw** (`skill-contract.ts`): inyectar solo `<name>+<description>` en XML y dejar que el CLI cargue el `SKILL.md` con su **propia read tool**. Funciona sin controlar el loop — encaja perfecto con Exegol. `nullclaw` lo reduce a un flag `always: bool`. |
| **Agent-Memory** (supersession/decay) | Confirmado con fórmulas concretas de **memU**. Ver §5. |
| **agent-eval / theloop** (evaluator + two-pass judge) | Confirmado, sin cambios. Aplicar a T88. |

---

## 4. Oplog v2 — el modelo GitButler (differentiator principal)

GitButler (`crates/gitbutler-oplog/`) resuelve exactamente lo que agent-undo prometía, pero sobre git puro:

- **Snapshots = git trees**: cada snapshot es un commit cuyo tree captura `worktree/ + index/ + estado de la app`. El log = commits encadenados parent-child.
- **Metadata en git trailers** del commit message: `SnapshotDetails { operation: OperationKind, trailers }` — su enum de ~60 `OperationKind` es el vocabulario de "operaciones de agente" que queremos deshacer.
- **Anti-GC vía reflog hack** (`reflog.rs`): ref falsa `gitbutler/target` con reflog falsificado — el oplog es reachable pero invisible en `git log --all`.
- **Unmaterialized snapshots** (`but-oplog`): `prepare_snapshot()` arma el tree en memoria y solo `commit_snapshot()` si la operación tuvo éxito. Ideal para "snapshot antes de cada turno del agente".
- Todo es portable a nuestro stack git2/napi (el legacy de GitButler estaba escrito sobre git2).

**Complemento de t3code**: checkpoints como git-refs ocultos *por turno del agente* (`CheckpointStore.ts`), con diff computado entre checkpoints. Combinado con la detección de estado del §2 (sabemos cuándo empieza/termina un turno), Exegol puede snapshotear **cada turno de cada agente** y ofrecer undo granular con atribución — sin daemon, sin CAS, sin file watcher.

**Bonus de GitButler adoptables después**: hunk assignment con UUID estable (atribuir hunks a agentes/PRs en GitPane), commit absorb (redistribuir fixups del agente al commit correcto).

---

## 5. Search y memoria — recetas listas para copiar

**Hybrid search (qmd, `src/store.ts`):**
- RRF: `score += weight / (60 + rank + 1)` por lista; bonus +0.05 si rank 0, +0.02 si rank ≤ 2 (línea 3982).
- Pesos: listas de la query original ×2.0, expansiones ×1.0.
- BM25 con pesos por columna: `bm25(fts, 1.5, 4.0, 1.0)` (filepath, title, body).
- Sonda "señal fuerte BM25 → salta el trabajo caro (expansión LLM)".
- Rerank sobre **chunks, no documentos**; blend posición-consciente: `0.75·(1/rrfRank) + 0.25·rerank` para top-3 (protege top results del desacuerdo del reranker).
- Exegol ya tiene FTS5 (sin usar — `memory/store.ts` usa LIKE) + embeddings Ollama (T100). Es conectar piezas existentes.

**Memory scoring (memU, `src/memu/vector.py`):**
- `salience = similarity × log(reinforcement_count + 1) × exp(-0.693 × days_ago / 30)` — decay half-life de 30 días.
- Campos nuevos: `reinforcement_count` + `last_reinforced_at` — al re-observar un hecho se refuerza en vez de duplicar. Esto ES la supersession pragmática que el review anterior pedía.
- Categorías: añadir `tool` y `behavior` a las 5 actuales; reglas de prompt anti-efímero.

---

## 6. Notificaciones — el patrón irreducible de openclaw

Los 3 clones minimalistas de openclaw (nanoclaw, nanobot, nullclaw) tiraron los 100+ canales y conservaron lo mismo: **bus de mensajes + interfaz de canal de 1-3 métodos**. `nanoclaw/src/delivery.ts`: `deliver(channelType, platformId, threadId, kind, content, files?)`.

**Propuesta:** un `NotificationBus` en main que recibe eventos (`agent:attention`, `agent:finished`, `pipeline:paused`, `run:failed` — alimentados por los hooks del §2) y canales plugin:
1. **Desktop** (Notification API de Electron + badge en dock + sonido) — pre-launch.
2. **Telegram** — post-launch; AgentsRoom demostró demanda de monitoreo remoto, y es barato con este diseño.

---

## 7. Ideas arquitecturales secundarias (adoptar con el tiempo)

- **Status derivado en read-time + CDC** (agent-orchestrator): nunca persistir "display status"; guardar facts durables (`is_terminated`, `activity_state`) y derivar `running/failed/needs_input` al leer. Tabla `change_log` con seq-watermark (triggers SQLite) para que el renderer reconecte sin perder eventos. Mata la clase entera de bugs de estado stale.
- **Tiered merge resolver** (overstory): para pipelines/parallel runs — (1) merge limpio → (2) keep-incoming → (3) AI-resolve → (4) reimplement-from-spec. Auto-commitear artefactos de estado (`.claude/`) para que no bloqueen merges.
- **ModeTracker headless** (superset): xterm-headless por sesión (scrollback 1) que trackea modos VT (kitty keyboard, bracketed paste) y reconstruye preamble al reattach — arregla Shift+Enter/paste tras reload.
- **terminal-url-detector** (emdash): detectar `http://localhost:PORT` en el PTY y ofrecer "abrir en browser pane". Quick win con el pane browser existente.
- **ACP — Agent Client Protocol** (emdash + t3code + Zed): JSON-RPC estructurado con el agente en vez de PTY scraping, con driver-fallback. Es el futuro del espacio, pero es un refactor de boundary grande. Evaluar como P2: empezar con un solo provider (Claude Code o Gemini, ambos con soporte ACP) en un pane experimental.
- **Automations con catálogo** (emdash `builtin-catalog.ts` + openclaw heartbeat): Exegol ya tiene `scheduler/engine` — falta el catálogo de plantillas ("scan vulns", "daily summary", "add test coverage") y la entrega del resultado vía NotificationBus. Mucho valor percibido por poco esfuerzo.
- **Security-scan pre-import de skills/MCPs** (mission-control): gate con patrones (prompt-injection, secret-leak, shell peligroso) antes de instalar skills externas. Relevante si abrimos marketplace/import de skills.

## Lo que NO haría (opinión honesta)

- **Contenedores estilo Sculptor** — worktrees + accessModes cubren el 90% con 10% de la fricción. Docker como requisito mata onboarding.
- **Virtual branches** (GitButler) — filosóficamente opuesto a agentes paralelos: N ramas en 1 workdir vs procesos concurrentes que necesitan aislamiento de fs. Robar el oplog y hunk assignment, no el modelo.
- **Model routing propio** (ClawRouter/pareto-router) — el provider gestiona el modelo. Fuera de scope.
- **Sync cloud tipo superset** (Postgres + ElectricSQL) — local-first es ventaja de onboarding y de privacidad. No copiar.
- **Kanban-first** (vibe-kanban) — el mercado lo probó y no sostuvo un negocio.

---

## 8. Plan propuesto

### P0 — Pre-launch (table stakes + quick wins, ~3-4 semanas)
| # | Feature | Fuente | Esfuerzo |
|---|---|---|---|
| 1 | **Estado por hooks + OSC 777** (FSM en sidecar/Rust, hooks por provider, scraping como fallback) | terax + superset | Medio |
| 2 | **NotificationBus + notificaciones desktop** (attention/finished/paused) | openclaw clones | Bajo |
| 3 | **Hybrid search RRF** (FTS5 + Ollama + fórmula qmd) en memory/search | qmd | Bajo |
| 4 | **Memory salience v2** (decay half-life + reinforcement + supersession) | memU | Bajo |
| 5 | **Progressive disclosure skills** (metadata-only + read on-demand) | openclaw | Bajo-Medio |
| 6 | terminal-url-detector → browser pane | emdash | Bajo |

### P1 — Diferenciadores (el headline del lanzamiento)
| # | Feature | Fuente |
|---|---|---|
| 7 | **Oplog v2**: snapshot git-tree por turno de agente, OperationKind trailers, reflog anti-GC, undo granular con atribución | GitButler + t3code |
| 8 | **Pipeline Evidence** (estilo Antigravity Artifacts, multi-provider): cada paso guarda diff + scrollback + screenshot del browser pane + score → panel de review con evidencia verificable | Antigravity (gap) |
| 9 | **Evaluator gate estadístico** en loops review→fix: two-pass judge, score distribution, ship/hold/retry | agent-eval + theloop |
| 10 | **Race mode polish** (T65): cleanup del loser + defer mode | runoff |

### P2 — Apuestas post-launch
| # | Feature | Fuente |
|---|---|---|
| 11 | Automations catalog sobre el scheduler existente + heartbeat declarativo | emdash + openclaw |
| 12 | Canal Telegram / viewer remoto | openclaw + AgentsRoom |
| 13 | ACP boundary experimental (1 provider) | emdash + t3code + Zed |
| 14 | Status derivado + CDC change_log | agent-orchestrator |
| 15 | Tiered merge resolver para parallel runs | overstory |
| 16 | Hunk assignment + absorb en GitPane | GitButler |

### Posicionamiento sugerido para el launch
> "Exegol no es otro wrapper de worktrees. Es la capa de orquestación: pipelines multi-provider con loops de review, evidencia verificable por paso, undo granular de cada turno de cada agente, y scoring que te dice qué agente rinde mejor en TU repo. Y tus agentes sobreviven a un reload."

Los 4 pilares del pitch: **Pipelines → Evidence → Undo → Scoring**, sobre la base de resiliencia del sidecar.
