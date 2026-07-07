# Code Health Audit — 2026-07-06

Auditoría de salud del código (Fable session, 2026-07-06) + verificación competitiva web.
Feeds Wave 2.6 (T149–T152). Companion: `COMPETITIVE_REVIEW_2026_07.md` (tesis de moat re-validada).

## Veredicto

Fundamentos fuertes (seguridad, type safety, higiene de módulos, deps), pero el 20% más
riesgoso del código no está verificado: el core de orquestación no tiene tests y hay dos
"half-builds" (T80 errors, capability allowlist) construidos y nunca conectados.

## Hallazgos por severidad

### ALTA — core de orquestación sin tests
- Renderer: 6 test files / 179 src. Main: lo testeado es lógica pura (parsers, scoring, salience).
- **Cero tests**: `pipeline/executor.ts`, `agents/manager.ts`, `pty-sidecar-entry.ts` (441 LOC),
  `pty-host.ts` (460), `mcp/exegol-server.ts`, `mcp/host.ts` (439), `agents/queue.ts`,
  `agents/race-mode.ts`, `scheduler/engine.ts`, **`db/migrations.ts` (588 LOC — corrupción de
  datos sin red)**.
- Único punto brillante: `memory/store.ts` sí tiene tests. Rust es la parte mejor testeada (8/15 archivos).
→ **T149**

### MEDIA — error handling construido y no cableado (T80)
- `lib/errors.ts` define `ExegolError` → `Transient/Permanent/Timeout` + `withRetry()` (exponential backoff).
- `withRetry()` tiene **cero call sites** — dead code. Solo 3 archivos usan las subclases.
- Camino crítico: 31 `throw new Error` genéricos (executor:78,117,121,289,293; manager:72,79,94).
- Patrón dominante: catch → log → continue (razonable) pero sin clasificación ni retry.
→ **T150**

### MEDIA — espejo Rust↔JS sin parity tests
- `agents/status-parser.ts` (377 LOC) es mirror manual de `status_parser.rs` + `strip_ansi.rs`.
- El fallback JS es lo que ven los usuarios cuando el build nativo falta; sin golden vectors
  compartidos deriva silenciosamente.
→ **T150**

### MEDIA — god-modules
1. `renderer/stores/workspace.ts` — **698 LOC** (viola la regla 400-500 del board)
2. `main/index.ts` — 506 LOC (bootstrap dumping ground)
3. Siguientes: CommandPalette 498, FileExplorer 493, FloatingBrowser 468, WorkspacePane 468,
   pty-host 460, ipc/procedures/agents 452, system/resources 449
→ **T152**

### BAJA — polish de seguridad (el área más fuerte del repo)
- Keystore: fallback a **texto plano** en settings cuando `safeStorage.isEncryptionAvailable()`
  es false (`keystore.ts:10-15`) — sin aviso al usuario.
- `preload/capabilities.json`: mecanismo correcto pero muchos routers en wildcard `"*"`.
- `coverage/` commiteado con datos parciales (solo agents/memory/pipeline/terminal).
- Lo bueno (verificado): MCP socket 0600 + token por agente revocado al exit, command-guard
  con detección de evasión (`\rm`, bidi Trojan-Source), git sin interpolación de strings,
  0 `@ts-ignore`, 2 `as any` en 399 archivos, 0 TODOs reales, deps modernas sin deuda.
→ **T151**

## Contexto competitivo (verificación web 2026-07)

- Muertos: Terragon (ene), Bloop/Vibe Kanban (abr), Crystal → Nimbalyst. Conductor: $22M Serie A,
  gratis, releases semanales. Omnara: 20k users / $9mo validó control remoto móvil.
- First-party ya tiene multi-agente nativo: Claude Code agent teams + worktree/sesión + /rewind
  + web/móvil; Codex app; Cursor 3.2 /multitask; Antigravity Agent Manager.
- **Moat de Exegol re-validado**: nadie en la matriz de 12 herramientas tiene pipelines con
  evaluator gates + memoria cross-provider con salience + oplog-undo + budgets + MCP de memoria.
- Brecha más visible: continuidad remota/móvil (T133/T93/T94 — candidatos a subir la próxima vuelta).
- Quick win de marketing: páginas "Vibe Kanban / Terragon alternative" (Nimbalyst captura esos
  huérfanos hoy vía SEO).
