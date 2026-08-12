# cocoindex — análisis 2026-08-12

Repos locales: `_repos_2_learn/github.com/cocoindex-io/{cocoindex,realtime-codebase-indexing}`
(Apache-2.0, HEAD 2026-08-11 — activo) · Feeds **T153, T164 (nuevo), indexer, memory store**.

**Qué es**: NO es un framework Python — es un **motor Rust de dataflow incremental** (~83k LOC
Rust, PyO3 como fachada, SDK Rust nativo con features `sqlite`/`fastembed`/`fs_live`/`text`).
El ejemplo realtime-codebase-indexing son ~190 líneas: walk → tree-sitter chunk → MiniLM →
pgvector, `live=True`. Todo el valor está en el motor.

**Veredicto de adopción**: **adoptar los patrones, mantener nuestro stack TS/Rust — NO
vendorear el crate.** Python path = descalificado (torch en Electron). Rust SDK = crate
interno pre-1.0 sin publicar, y arrastra LMDB (segunda DB junto a libsql) + ONNX (segundo
runtime junto al sidecar llama.cpp planeado) + 35 gramáticas tree-sitter. El único pedazo
vendoreable aislado: `rust/ops_text` + `rust/code_ast` (chunker DP + extractor de símbolos,
sin motor ni LMDB) — o reimplementar el algoritmo (~400 líneas) contra nuestro tree-sitter.

## Patrones adoptables (ranked)

1. **Freshness dos niveles** (`resources/file.py:183`): `mtime` igual → ni leer el archivo;
   `mtime` distinto → hash de contenido; hash igual → **reusar resultado Y persistir el mtime
   nuevo** (el caso tercero "tocado pero idéntico" es lo que salva un `git checkout` de
   re-embedear el repo entero). T153 necesita AMBOS: solo-hash = O(read) por sweep;
   solo-mtime = re-embed total en cada branch switch.
2. **Logic fingerprint** (`function.py:624`): la cache key incluye hash del AST de la función
   transformadora (sin docstrings/comentarios) — editar el collector invalida su cache sin
   version-bump manual. Equivalente nuestro: `COLLECTOR_VERSION` const por collector en la key,
   o hash del source del collector vía build script.
3. **Identidad del modelo como dependencia de cache** (`ContextKey("embedder")`): cambiar
   nomic-embed-text → llama.cpp debe invalidar TODOS los vectores (cosine con vectores de otro
   modelo devuelve números, no verdad). Guardar `(model_id, dim, quant)` en la key de cada
   segmento — indexer Y memory store.
4. **Reconcile por ownership + row fingerprint** (`sqlite/_target.py:558`): fila sin cambio de
   fingerprint = cero writes (importa con FTS5: un UPDATE no-op reescribe el índice FTS);
   borrado dirigido por ownership (archivo desaparece → sus filas derivadas caen solas, sin
   lógica de cleanup ad-hoc). Modelar `owner_path` en nuestras filas derivadas.
5. **Watch loop con red de seguridad** (`localfs/_source.py:190-320`): watcher ANTES del scan
   inicial; MOVED = DELETE+CREATE; dir-delete → rescan completo; **recrear el watcher + full
   rescan cada hora porque macOS FSEvents se muere silenciosamente** (nos aplica directo);
   un solo code path para "index now" y "keep watching".
6. **Ids estables para chunks duplicados** (`resources/id.py`): key `(content_fp, ordinal)` —
   ni colisión de boilerplate idéntico (hash-de-texto) ni renumeración total al insertar una
   línea arriba (file+ordinal).
7. **Capa de símbolos tree-sitter** (`code_ast/elements/types.rs`): `Declaration` con
   `entity_name` calificado ("OrderService.PlaceOrder") + `Reference` (call-graph edges) con
   vocabulario cross-language normalizado; declaraciones dentro de cuerpos de función se
   DESCARTAN (tabla de símbolos a nivel módulo/tipo/miembro, no explota). `Reference` =
   acoplamiento estático para cruzar con nuestro co-change de git.
8. **Términos FTS derivados del AST** (identifiers + contenido de strings, no texto crudo
   tokenizado) — mata el ruido de keywords y mejora el recall FTS5 sobre código. Disciplina de
   soundness: falso positivo tolerable, falso negativo jamás — exactamente la filosofía de la
   tabla `index_coverage` de T153.
9. **Source views para context packs** (`code_ast/view/`): snippet + frame lines de los scopes
   que lo envuelven (`class Foo:` / `def bar():`), cada línea trazable a un rango real de bytes.
   Invariante: texto sintético = concatenación de segmentos anclados. El formato correcto para
   los context packs de T153.
10. **`drop` desde el día uno**: una cache incremental corrupta sin reset es una pesadilla de
    soporte (~10% del motor es inspección/CLI de estado).

## Hipótesis de Antonio: "las memorias alrededor del índice"

**Correcta en dirección, invertida en framing: el índice no es DONDE viven las memorias — es
el SISTEMA DE COORDENADAS con el que se direccionan.** cocoindex separa siempre: índice
derivado (desechable, recomputable), estado de tracking, y fuente. Las memorias son una
CUARTA categoría: no derivadas, no recomputables, irrecuperables si se pierden. Meterlas como
filas del índice = cada reindex/model-swap/chunk-shift las huerfanea.

**El acoplamiento correcto — tabla de anclas, no merge** (→ nuevo T164):

```
memory_anchor(memory_id, anchor_kind: file|symbol|range|commit,
  path, symbol_qname, symbol_kind, start_line, end_line,
  anchor_source_hash, anchor_snippet_fp,
  confidence: explicit|inferred|llm-guessed,
  state: fresh|drifted|orphaned|relocated, last_verified_at)
```

- **Ancla por símbolo calificado, no por líneas** — `entity_name` sobrevive ediciones en el
  resto del archivo; refactor que mueve el símbolo → relink por qname+snippet_fp = `relocated`.
- **Staleness = el check de dos niveles aplicado a memorias**: mtime igual → nada; hash de
  archivo cambió pero `snippet_fp` del símbolo igual → **sigue fresh** (editaron otra función
  — el caso de alto valor); cuerpo del símbolo cambió → `drifted`; símbolo desapareció →
  `orphaned`.
- **`drifted` es señal de ranking, no delete**: penaliza recall + flag en el context pack
  ("nota escrita contra una versión anterior de X"); `orphaned` se suprime del recall default,
  nunca hard-delete. Distinto de `supersede` (semántico) — drift es mecánico; campos separados.
- **Retrieval location-aware — donde más paga**: al spawn sobre `src/auth/session.rs`, el
  context pack trae (a) memorias ancladas a ese archivo/símbolo, (b) a símbolos que REFERENCIA
  (call-graph), (c) a archivos que co-cambian (collector git) — antes del RRF global. Mejor
  prior que similitud semántica sola.
- **Write path MCP**: `memory_save` acepta ancla opcional (`path` + símbolo/rango resuelto
  server-side contra las declaraciones extraídas) → `confidence=explicit`; sin ancla, inferir
  de los archivos tocados en el turno → `inferred`. **Jamás aceptar un `symbol_qname` del LLM
  sin validarlo** — ancla inválida hace mentir el staleness check.
- La verificación de anclas corre en EL MISMO sweep, con LOS MISMOS hashes que el index update
  — no un cron aparte. Anclas no visitadas se registran como no-visitadas (honestidad
  index_coverage), nunca se asumen fresh.

## NO copiar

LMDB side-store (tracking va en tablas libsql junto a los datos — una sola DB, un solo modo de
corrupción) · pgvector/Postgres · su query path (cosine puro sin hybrid — nuestro RRF ya es
mejor; no regresionar) · el modelo declarativo mount/component/tombstones (~4k LOC para
pipelines arbitrarios de usuarios; tenemos UN pipeline conocido en compile time — función
directa con check de cache explícito) · chunk sizing en bytes tal cual (1000 bytes vs ventana
256-token de MiniLM = truncado silencioso; conservar el ratio de overlap 30%, dimensionar en
tokens del modelo real) · `live=True` por default (watcher por proyecto = batería/IO; opt-in,
pausar si el proyecto no es el workspace activo, debounce fuerte — los agentes escribiendo
generan tormentas de eventos) · las 35 gramáticas wholesale (empezar con los lenguajes reales
de los usuarios; el fallback regex del splitter ya degrada con gracia) · competir con
`cocoindex-code` (su CLI+MCP de code search endurecido): nuestro diferenciador es memorias +
awareness ligadas a sesiones orquestadas — poder convivir con él, no duplicarlo.
