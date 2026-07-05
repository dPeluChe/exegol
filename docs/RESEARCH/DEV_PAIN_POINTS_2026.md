# Dev Pain Points 2025-2026 — quejas top vs plan de Exegol

> Research jul-2026. Fuentes: Stack Overflow Survey 2025, HN, Reddit, GitClear, DORA.
> Uso: priorización del backlog + material de messaging para el launch.

| # | Queja (frecuencia/intensidad) | Evidencia | Cobertura en Exegol |
|---|---|---|---|
| 1 | Código "casi correcto" que cuesta más arreglar que escribir | SO 2025: 66% lo cita; solo ~30% confía en el output | **T88v2** evaluator gate + scoring; gate de tests/lint por step (T88v2 scope) |
| 2 | Costos sorpresa, rate limits, repricing (Cursor jun-25: $100/mes → $20-30/día) | DEV/Medium repricing posts | **T147 (nuevo)** cost dashboard + budgets |
| 3 | Pérdida de contexto / compaction hell — re-explicar todo cada sesión | golev.com, DEV; la gente inventa PROGRESS.md manuales | **T126 + T140 + T145** — el "briefing pack" al spawn es exactamente esto |
| 4 | Babysitting: agente esperando input sin avisar (10 min perdidos) | Mini-ecosistema nacido: AgentsRoom Dynamic Island, herdr, agterm | **T123 + T124 + T141** — núcleo de la wave |
| 5 | Review fatigue: generan más rápido de lo que puedes revisar; mega-PRs | Consenso HN 2026: el cuello pasó de escribir a revisar | **T130** evidence + AI diff summary por step |
| 6 | Deuda técnica: duplicación 8× (GitClear), churn 3.1%→5.7% | GitClear 211M líneas, DORA | T88v2 loop review→fix + métrica churn en scoring (futuro) |
| 7 | Setup complexity + MCP fatigue (21K tokens de tools antes de empezar) | lunar.dev, the-agent-report | Registry unificado + **T148 (nuevo)** onboarding wizard + T127 disclosure |
| 8 | Merge conflicts / worktree chaos entre agentes paralelos | Nació tooling ad-hoc (clash) | Worktrees core + **T136** (+ overlap detection añadido) |
| 9 | Degradación de las CLIs (startup, tokens inflados) | Reddit r/ClaudeAI recurrente | Mitigación: sidecar resiliente + health por sesión (parcial) |
| 10 | Vendor lock-in / miedo al repricing de mañana | HN "AI fatigue" | Multi-provider + comparator A/B (T65/T107) — antídoto directo |

**Señal transversal**: el mercado converge a "orquestación con supervisión humana en checkpoints" > autonomía total ("Professional developers don't vibe, they control" — HN). Exegol está exactamente en esa tesis.

**Los 3 gaps más rentables por frecuencia de queja**: notificaciones waiting_input (#4 → en plan), cost dashboard con budgets (#2 → T147), diff summary para review (#5 → T130).

**Para el messaging del launch**: cada pilar responde una queja top — "tus agentes te avisan (#4), sabes lo que gastas (#2), revisas evidencia, no mega-diffs (#5), y nada se olvida entre sesiones (#3)".
