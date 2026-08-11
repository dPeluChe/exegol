# trinity (abilityai) — análisis 2026-08-11

Repo local: `_repos_2_learn/github.com/abilityai/trinity` (FastAPI+Vue+FastMCP, Apache 2.0
open-core, v0.8.5, producción real con pentest — MADURO) · Feeds **T157, T158**, pipelines.

**Qué es**: plataforma self-hosted de agentes AUTÓNOMOS de larga vida — Docker por agente,
canales (Slack/Telegram/VoIP), schedules. Resuelve *fleet-de-servicios*; Exegol resuelve
*orquestación dev local interactiva*. **Adoptar conceptos, no arquitectura** (breakers/Redis/
leader-locks/Docker = problemas de servidor multi-worker que no tenemos). Su memoria es
pobre vs la nuestra (blob por usuario; nada de salience) — no regresionar.

## Patrones adoptables (ranked)

1. **Protocolo human-gate con semántica de turno** → T157/attention: items tipados
   `question|approval|alert` que el agente PARQUEA ("park, end your turn, never poll";
   "haz ahora lo reversible; gatea solo lo irreversible"), expiry = denegación, respuesta
   procesada en el siguiente turno. Convierte esperar-al-humano en estado durable y
   resumible. Ref: `platform_prompt_service.py:54-120`, `operator_queue_service.py`.
2. **Platform prompt como maestro de protocolos** → T158: bloque de system-prompt compuesto
   por spawn, runtime-aware, que ENSEÑA los hábitos (memoria, inbox, setup persistente).
   715 líneas de `platform_prompt_service.py` = la referencia exacta para nuestro
   spawn-context.
3. **Wake por evento de completion con loop-safety** → T157: eventos deterministas
   `agent.task.completed/failed` despiertan al suscriptor con task de report-back; triple
   guarda anti-loop (namespace reservado + no self-subscribe + marcador de recursión en
   turnos event-triggered). Ref: architecture.md §#1578.
4. **Permisos agente↔agente zero-default** → T157 trust model: tabla `agent_permissions`
   con grants explícitos chequeados en la capa MCP (`list_agents` solo muestra permitidos),
   auto-grant padre→hijo al spawnear. Complementa nuestro accept/hold/refuse.
5. **Doom-loop por fingerprint** → guard de loop-back en pipelines: SHA-256 del output
   normalizado; K idénticos → stop (~20 líneas; mejor que solo max-iterations).
6. **Identidad server-side para escrituras** — ya lo hacemos (T145 accessMode); extender
   el principio a TODA escritura atribuida a agente (resolver del token, jamás del claim).
7. **Self-reminders**: "despiértame en T con mensaje M", one-shot, self-scoped — encaja en
   nuestro scheduler casi gratis.

## También bueno

- `RuntimeCapabilities` dataclass (chat_continuity, session_resume, cost_reporting:
  native|estimated) — más limpio que lista de flags por provider.
- Effect-scoped idempotency (`effect_guard`): dedup en el SINK del efecto con identidad
  resuelta (nunca el body del LLM) — relevante si pipelines reintenta pasos con efectos.
- `AGENTS.md` como router de tareas para agentes ("Route by task" + "Done when").
- Agentes efímeros presupuestados (max ejecuciones/TTL, key fencing, no chain-spawn).

## NO copiar

Docker-por-agente (peso incorrecto para desktop; worktrees+PTY correcto) · aparato
Redis/breakers/leader-locks · engine YAML de procesos (nuestro executor tipado con
evaluator gates es más fuerte para coding) · memoria whole-blob.
