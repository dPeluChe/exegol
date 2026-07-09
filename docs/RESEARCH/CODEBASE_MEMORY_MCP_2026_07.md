# codebase-memory-mcp (DeusData) — análisis 2026-07-09

Repo local: `_repos_2_learn/github.com/DeusData/codebase-memory-mcp` · Feeds **T153**.

**Framing clave**: pese al nombre, NO es memoria conversacional — es un *code intelligence
engine*: grafo estructural del código (tree-sitter, 158 lenguajes, binario C11 estático sin
deps) servido por MCP. Como sistema de memoria es más pobre que el nuestro (sin salience,
sin provenance, sin supersede). Como **referencia de T153** es el artefacto más fuerte visto:
Linux kernel (28M LOC) en 3 min → 4.8M nodos / 7.7M edges. 14 MCP tools, subset openCypher,
indexado en subprocess supervisado (mismo instinto que nuestro PTY sidecar).

## Patrones a adoptar (con detalle implementable)

1. **`index_coverage` — tabla de honestidad**: una fila por archivo parcialmente indexado
   (`kind: parse_partial|read|extract|oversized` + detail). Distingue "no indexado" de
   "indexado con huecos" — el context pack de T153 nunca debe parecer completo sin serlo.
2. **`FILE_CHANGES_WITH` — acoplamiento por co-cambio git**: `git log --name-only --since='6 months'`,
   skip commits >20 archivos, mínimo 3 co-cambios, `score = co_count / min(count_a, count_b)`,
   umbral 0.3. Señal de drift determinista y baratísima para el Health Inbox: *"cambiaste A;
   B co-cambia 78% de las veces y no fue tocado"*.
3. **`detect_changes` — blast radius por hops**: diff sin commitear → símbolos afectados →
   BFS con riesgo por distancia (hop 1=CRITICAL, 2=HIGH, 3=MEDIUM). Input perfecto para
   evaluator gates y el Smart Git Button ("este commit toca 3 callers CRITICAL").
4. **`source_hash` caching**: cualquier resumen AI se cachea con hash de sus inputs;
   regenerar solo en mismatch. Exactamente lo que necesita el "purpose" por archivo de T153.
5. **min-cosine multi-keyword**: recall con varios términos = `min(cos_k)` (todos deben
   matchear), no promedio. Adoptable HOY en `memory/store.ts` (complementa RRF: RRF fusiona
   rankers, esto fusiona términos de la query).
6. **Watcher adaptativo barato**: poll de `git rev-parse HEAD` + `status --porcelain`,
   intervalo 5s + 1s/500 archivos (cap 60s). Menos ruido que FS events para la micro-task
   queue; complementar con nuestros hooks OSC/afterCommit para reacción intra-sesión.
7. **Artefacto derivado commiteado**: `.codebase-memory/graph.db.zst` (zstd 8-13:1) +
   auto-línea `.gitattributes merge=ours` (cero conflictos binarios). Si el índice de T153
   se vuelve caro, este es el patrón para compartirlo en equipo.
8. **Errores MCP escritos para el LLM**: hints en cero-resultados, ejemplos correctivos en
   args mal tipados → menos retry loops. Aplicar a nuestros tools T145.
9. **ADR con CRUD por sección**: documento de decisiones editable por agentes dentro del
   store. Mapea a `PROJECT.md` del knowledge node — ops de update por sección.
10. **Schema por símbolo probado**: `qualified_name` como key estable + properties
    `{signature, docstring, return_type, decorators, complexity, is_entry_point}` +
    `file_hashes(sha256, mtime_ns, size)` como ledger de staleness.

## Lo que NO copiar

- **Overwrite-on-reindex**: correcto para un grafo derivado (rebuildeable desde el código),
  regresión para nuestras memorias-observación. Salience/supersede es superior — mantener.
- **Zoo de 11 señales con pesos mágicos** (existe para evitar inferencia de modelo): con
  Ollama ya integrado, embeddings reales + RRF es menos maquinaria. Robar solo min-cosine.
- **Reescritura C11 / vendoring masivo**: su perf es su producto; no envidiar (store.c de
  6,700 líneas, soak lane de 4h por leak real #581).
- **Update-check silencioso a GitHub en initialize** — no replicar llamadas de red calladas.

## Opción estratégica para T153

Su moat (call-graph 158 lenguajes) es también su carga de mantenimiento. T153 debe quedarse
en granularidad archivo/exports — **o considerar shellear a esta tool** (tiene modo CLI:
`codebase-memory-mcp cli search_graph '{...}'` + JSON-RPC documentado) en vez de reconstruir
indexado tree-sitter dentro de Exegol. Evaluar en el design spike de T153.

## Madurez

Muy activo (1,453 commits en 4.5 meses), ingeniería seria (~2,040 tests, ASan/UBSan, SLSA L3,
Sigstore, preprint arXiv con eval de 31 repos). Riesgos: joven (feb 2026), bus-factor 1,
números self-reported, C con vendoring pesado.
