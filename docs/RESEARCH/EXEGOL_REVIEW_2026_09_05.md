# Exegol: revisión técnica, competencia y prioridades

Fecha: 2026-09-05. Código analizado: `a99b631f39ce1228e143be1541bb542f7f014e6b`, rama `feat/t183-terminal-fidelity`.

La siguiente etapa debería concentrarse en que una tarea produzca un cambio verificable, recuperable y fácil de revisar. Exegol ya tiene terminales persistentes, agentes de varios proveedores, pipelines, memoria y coordinación. El rendimiento comercial de esas piezas depende de que funcionen juntas y de que el usuario pueda comprobar sus resultados.

La revisión encontró una contradicción concreta: el pipeline pide commits, pero obtiene evidencia con `git diff HEAD`, que omite los cambios ya confirmados. También reprodujo problemas del scheduler, del indexador y de la memoria. Mientras tanto, los competidores ya ofrecen múltiples proveedores, automatizaciones y acceso remoto. Presentar esas capacidades como exclusivas de Exegol dejaría el posicionamiento por detrás del producto real de otros.

Recomiendo este orden: corregir evidencia y controles de calidad; cerrar fallos de recuperación; entregar un flujo completo de revisión; después desarrollar Awareness/Owl con datos comprobables y añadir continuidad remota.

## Alcance y calidad de la evidencia

Se revisaron manifiestos, historial Git, arquitectura, backlog, documentación de distribución, investigaciones anteriores y rutas críticas del código. Se ejecutaron las pruebas existentes y siete pruebas diagnósticas aisladas. Estas últimas usaron archivos sintéticos, SQLite en memoria y mocks de proveedores; no ejecutaron agentes ni enviaron código a un modelo.

Spark identificó los repos de referencia. Se actualizaron nueve mediante `git pull --ff-only`, comprobando que estuvieran limpios antes y después. Se estudiaron implementaciones seleccionadas de Superset, Emdash, Jean, OpenChamber, Proliferate, Agent of Empires y MCP Agent Mail. Herdr y T3 Code se compararon principalmente por sus capacidades documentadas. También se consultaron fuentes oficiales mediante TinyFish, incluyendo Conductor.

Las etiquetas empleadas son:

| Etiqueta | Significado |
|---|---|
| Reproducido | Una prueba aislada observó el comportamiento en nuestro código |
| Código | La implementación muestra el mecanismo; falta comprobar su frecuencia en uso real |
| Documentado | El proveedor lo describe públicamente; no equivale a una prueba de funcionamiento |
| Propuesta | Decisión sugerida para Exegol, pendiente de implementación o validación |

No se ejecutó un benchmark interactivo de Electron, ni una prueba del instalador, ni las suites de los competidores. Los tiempos y porcentajes propuestos más adelante son objetivos, no resultados medidos. La revisión es profunda sobre los mecanismos citados, no una auditoría exhaustiva de las 76 mil líneas del proyecto.

## Kickoff: Exegol

**One-liner**: aplicación desktop para ejecutar y coordinar agentes de programación con terminales persistentes, contexto compartido y revisión de cambios.

**Stack (real)**: Electron 41.0.2, React 18.3, TypeScript, Tailwind 4, Zustand 5, tRPC 11, libSQL, xterm 6, node-pty y Rust mediante napi-rs. Bun y Turborepo coordinan el monorepo. Versión desktop declarada: 0.4.1.

**Activity**: último commit local del 22 de agosto; árbol limpio al comenzar. [PR #114](https://github.com/dPeluChe/exegol/pull/114) abierta, no draft, mergeable, sin checks reportados por GitHub. La revisión no hizo commits, push ni merge.

**Status read**: proyecto activo con implementación considerable y verificaciones pendientes. GitHub confirma que el repositorio es público, tiene cero workflows de Actions y no devolvió releases en la consulta realizada.

### Core modules

| Módulo | Responsabilidad y riesgo relevante |
|---|---|
| `main/agents` | Spawn, estado, mensajería, coordinación y limpieza; conecta procesos con estado persistido |
| `main/terminal` | Sidecar, transporte, ring buffers y reconstrucción de terminal; determina continuidad y fidelidad |
| `main/db` + `main/mcp` | Estado durable, identidad y operaciones disponibles para agentes |
| `main/pipeline` | Secuencias, revisión, evaluación y evidencia; principal candidato a diferenciación |
| `main/memory` + `main/knowledge` + `main/indexer` | Memoria y contexto; necesitan garantías de procedencia, alcance y actualización |

### Where things stand

Los commits recientes añadieron historial por repositorio, acciones de Makefile/justfile, durabilidad de mensajes y mejoras de terminal. También corrigieron procedimientos que existían pero no estaban permitidos por la lista de capacidades. Eso apunta a un riesgo recurrente: una pieza puede estar implementada y probada aisladamente sin que su recorrido completo sea utilizable.

El inventario contiene 686 archivos versionados y 534 archivos `.ts`, `.tsx` o `.rs`, con 76,532 líneas incluyendo pruebas y declaraciones. Hay módulos que superan de nuevo la guía de 400-500 líneas: `SpawnAgentModal.tsx` tiene 689, `exegol-server.ts` 626 y `AgentDashboard.tsx` 612. Su tamaño justifica atención cuando se modifiquen; no justifica una refactorización general antes de corregir los fallos funcionales.

### Reality-check findings

| Documentación o supuesto | Evidencia actual | Verificación | Severidad |
|---|---|---|---|
| T45 espera a que el repo sea público | GitHub devuelve `private: false`, cero workflows | `gh api repos/dPeluChe/exegol` y `gh api repos/dPeluChe/exegol/actions/workflows` | Alta |
| `bun run lint` es un control de calidad | Ningún workspace define script `lint`; Turbo muestra `<NONEXISTENT>` | `bunx turbo run lint --dry=json` | Alta |
| Memoria detecta contradicciones | La similitud léxica puede reforzar una instrucción con sentido opuesto | Prueba Always/Never descrita abajo | Alta |
| Cap global de rings equivale a memoria limitada | Solo se expulsan sesiones inactivas; las activas pueden superar ese objetivo | `pty-sidecar-eviction.ts`, filtro de `idleCandidates` | Media |
| `FEATURES.md` encabeza v0.4.4 | `apps/desktop/package.json` declara 0.4.1 | Leer ambos archivos | Media |
| Guía de release todavía pide reemplazar `your-org` | Updater y builder ya usan `dPeluChe/exegol` | `rg 'GITHUB_OWNER|owner:' apps/desktop/src/main/system/auto-updater.ts apps/desktop/electron-builder.ts` | Media |
| CLAUDE.md describe OSC como vía principal de señales | El backlog registra que la vía operativa se corrigió mediante file events | T123, verificación del 9 de julio, y `agent-file-events.test.ts` | Media |
| Documentación Rust menciona 12 pruebas | La ejecución actual pasa 55 | `cargo test --offline` | Baja |
| Benchmark del chunk inicial: 1,026 KB | Artefacto local inspeccionado: 823,132 bytes | Tamaño de `apps/desktop/out/renderer/assets/index-20UoCnLq.js` | Baja |

El chunk inspeccionado está por debajo del objetivo documental de 1.1 MB, pero un solo chunk no mide todo el JavaScript inicial ni demuestra mejor tiempo de arranque. El build pudo reutilizar caché de Turbo.

### Routed findings

Para `/doctos`: actualizar guía de distribución, matriz competitiva, versión declarada, mecanismo de señales y descripción del límite de memoria. Mantener las investigaciones históricas como registros fechados y enlazar la revisión vigente.

Para `/pm-tasks`: resolver IDs repetidos, separar tareas completadas de verificación pendiente y dividir T183/T184 en cambios con criterios propios. Este informe no modifica el backlog.

### Suggested next actions

1. Corregir la captura de evidencia del pipeline y conectar un lint que ejecute trabajo real.
2. Añadir checks automáticos y reproducir los recorridos de recuperación de terminal, scheduler y mensajes.
3. Definir una entrega pequeña de revisión asistida y otra de Awareness determinista.
4. Resolver las decisiones contradictorias de Owl/inferencia antes de implementar su runtime.

**Status: DONE_WITH_CONCERNS**. Análisis completado; los defectos descritos y las verificaciones de distribución siguen pendientes.

## Hallazgos técnicos priorizados

### 1. La evidencia del pipeline omite commits del propio agente

Prioridad P0. Hallazgo existente en T184.1, confirmado en código.

[`captureGitDiff`](../../apps/desktop/src/main/pipeline/pipeline-helpers.ts) ejecuta `git diff HEAD` en la línea 18. Los prompts de [`context.ts`](../../apps/desktop/src/main/pipeline/context.ts) piden hacer commit tanto al implementar como al corregir. Después del commit, un worktree limpio produce un diff vacío aunque la tarea haya cambiado código. El evaluador lo interpreta como ausencia de cambios y el informe pierde la evidencia útil.

La solución debe registrar una base inmutable al iniciar el run y una referencia antes de cada paso. El diff acumulado se calcula respecto de esa base; el diff del paso, respecto de su referencia inicial. Hay que representar además archivos nuevos sin seguimiento, cambios staged y unstaged. Cambiar únicamente el comando por otro diff seguiría dejando casos sin cubrir.

No recomiendo quitar sin reemplazo el `maxBuffer` de 1 MB sugerido en T184. Un diff grande debe guardarse como artefacto, con manifest de archivos y lectura acotada para la UI o el modelo. Leerlo entero en memoria desplaza el problema al proceso principal.

Criterio de aceptación: implementar y hacer commit, revisar, corregir y hacer otro commit, reiniciar, exportar. Cada paso conserva la evidencia correcta y el acumulado incluye ambos commits. Un archivo nuevo y un diff mayor de 1 MB tienen resultados explícitos.

### 2. Los controles de calidad devuelven una confianza mayor a la real

Prioridad P0 para el script; P1 para CI. Hallazgo comprobado por comandos.

`bun run lint` termina correctamente, pero ninguno de los cinco workspaces define `lint`. La ejecución directa de Biome 2.4.7 sobre el alcance documentado sí encontró un error y dos advertencias: `autoFocus` en `SessionAlias.tsx`, un import sin uso en `knowledge/digest.ts` y la constante aproximada de ln(2) en `memory/salience.ts`.

El repositorio ya es público. GitHub devuelve cero workflows y la PR #114 no reporta checks. T45 debe dejar de depender de una condición que ya se cumplió. CI de validación y publicación de instaladores pueden implementarse por separado; la firma de macOS no impide ejecutar TypeScript, pruebas y lint en cada PR.

El `test` raíz ejecuta las pruebas desktop, no toda posible suite del monorepo. La configuración de coverage incluye ocho archivos concretos. Por tanto, 748 pruebas aprobadas no equivalen a cobertura general ni a verificación del producto empaquetado.

Criterio de aceptación: introducir deliberadamente un error de lint o de tipos hace fallar el comando raíz y el check de PR. La ejecución incluye una comprobación de paridad entre procedimientos y capacidades permitidas. Las pruebas de paquetes adicionales se enumeran explícitamente.

### 3. El scheduler libera capacidad aunque el agente siga ejecutándose

Prioridad P1. Reproducido con reloj simulado y callback de agente.

En [`scheduler/engine.ts`](../../apps/desktop/src/main/scheduler/engine.ts), el timeout de diez minutos registra `timeout` y resuelve la espera. Después se elimina la tarea de `runningTasks`, sin detener al agente. Una finalización posterior todavía ejecuta el callback y registra `success` o `failure` para la misma ejecución.

La prueba obtuvo dos resultados: primero timeout y después success. También comprobó que los valores almacenados de `maxTokenBudget` y `skillName` no llegan como tales a las opciones de spawn. Esto describe la ruta del scheduler, no demuestra que ningún otro mecanismo global pueda limitar recursos.

Además, el límite de concurrencia retorna sin crear una ejecución durable cuando no hay capacidad, aunque el log diga que la tarea se difiere. Las dependencias consultan el último éxito histórico, sin vincularlo a una ejecución del ciclo actual. Ambas decisiones requieren una semántica explícita antes de promocionar un catálogo de automatizaciones.

Propuesta: separar tarea programada de ejecución; persistir cola, intento y estado terminal; cerrar cada intento una sola vez. El timeout debe cancelar con confirmación o conservar el estado de ejecución desconocida/activa hasta reconciliarlo. Si se permite que una tarea siga corriendo, debe seguir consumiendo capacidad.

Emdash ofrece una referencia concreta: su [scheduler actualizado][emdash-scheduler] mantiene runs, estados, snapshots de configuración, cancelación mediante `AbortController` y reconciliación al arrancar. Adoptar esas garantías no requiere copiar su arquitectura completa.

Criterio de aceptación: un agente que termina en el minuto once no duplica resultados ni permite superar la concurrencia configurada; un reinicio conserva la cola; presupuesto y skill seleccionados tienen efecto verificable.

### 4. Un fallo temporal de embeddings deja huecos persistentes

Prioridad P1 antes de conectar T153 al indexador. Reproducido.

[`indexProject`](../../apps/desktop/src/main/indexer/project-indexer.ts) guarda el hash del archivo antes de completar sus embeddings. Si el proveedor devuelve `null`, almacena el chunk sin vector. En la siguiente ejecución, el hash coincide y el archivo se omite. La prueba simuló un primer fallo y un segundo proveedor saludable: hubo una sola llamada total y el vector siguió ausente.

El hash demuestra que el texto no cambió; no demuestra que su transformación terminó correctamente. Deben separarse frescura del contenido, completitud del índice y estado del proveedor. Los embeddings pendientes necesitan reintento, y el reemplazo de chunks debería publicarse de forma atómica una vez preparado.

Criterio de aceptación: tras una caída de Ollama, reindexar recupera los vectores pendientes sin tocar los archivos. La UI informa cuántos chunks están disponibles, pendientes o fallidos, en vez de mostrar únicamente `done`.

### 5. Cambiar de modelo no invalida los vectores existentes

Prioridad P1 antes de T153. Reproducido; el principio ya aparece en la investigación de CocoIndex y en T153.

La prueba indexó un archivo con `m1` y repitió con `m2`. No se generó un vector nuevo porque la caché solo compara el hash de contenido. [`cosineSimilarity`](../../packages/shared/src/lib/cosine.ts) también usa la dimensión menor en vez de rechazar dimensiones diferentes. Aun con dimensiones iguales, vectores de modelos distintos no representan necesariamente el mismo espacio.

Persistir identidad/versionado del modelo, dimensión y versión del chunker como parte de la generación del índice. Construir la generación nueva sin presentar resultados mezclados; permitir conservar la anterior mientras se prepara el reemplazo.

Criterio de aceptación: el cambio de modelo invalida correctamente; una consulta con generación incompatible devuelve una explicación, no un ranking aparentemente válido.

### 6. El indexador puede salir del repositorio a través de symlinks

Prioridad P1 antes de activación amplia. Reproducido con un archivo sintético externo.

El recorrido usa `stat`, que sigue enlaces, y no comprueba que el destino real siga dentro de la raíz. La prueba creó `linked/` apuntando a otro directorio temporal: su archivo terminó indexado. La lista predeterminada de exclusiones tampoco sustituye `.gitignore` ni una política explícita para archivos sensibles.

Esto importa incluso usando Ollama local: el proyecto adquiere contexto ajeno. Si se configura otro endpoint, ese texto puede enviarse a ese destino. No se observó ninguna exposición real durante esta revisión.

Propuesta: enumeración consciente de Git, límites por ruta real, política explícita de symlinks y alcance visible antes de indexar. Reutilizar los controles de paths existentes cuando sus garantías encajen; no asumir que una validación hecha para otro propósito cubre el recorrido recursivo.

Criterio de aceptación: un symlink externo se omite o exige inclusión explícita; un ciclo no produce recorridos repetidos; un archivo ignorado no se envía por defecto al embedder.

### 7. La memoria confunde similitud con equivalencia semántica

Prioridad P1. Reproducido; amplía T158/T164 y el estudio previo de Engram.

[`classifyObservation`](../../apps/desktop/src/main/memory/salience.ts) refuerza si la similitud de palabras supera 0.8 y reemplaza si supera 0.5. La prueba comparó estas instrucciones:

- `Always run database migrations before deploying the production application`
- `Never run database migrations before deploying the production application`

El resultado fue reforzar la memoria anterior. Además, compartir vocabulario no basta para demostrar que una observación sustituye a otra; dos hechos compatibles podrían quedar tratados como versiones rivales.

Primera corrección: deduplicación automática conservadora para equivalencia exacta normalizada; observaciones parecidas se conservan como candidatas relacionadas. Una sustitución necesita relación explícita, procedencia y motivo. Las decisiones del usuario deben poder distinguirse de inferencias del agente.

Después, introducir temas estables y anclas al código, manteniendo revisiones. La propuesta de T164 encaja aquí: el índice puede reconstruirse, pero la memoria de decisiones no debe perderse al regenerarlo.

Criterio de aceptación: negaciones, cambios de versión y hechos similares compatibles pasan una colección de ejemplos revisados por una persona. Una memoria supersedida sigue siendo consultable con su motivo y evidencia.

### 8. La reconstrucción del terminal depende de dónde se cortan los chunks

Prioridad P1. Reproducido; amplía T138 y el trabajo de terminal de T183/T184.

[`HeadlessEmulator`](../../apps/desktop/src/main/terminal/headless-emulator.ts) interpreta modos con una regex por llamada. La secuencia de bracketed paste dividida en dos writes deja el modo desactivado; enviada entera lo activa. También falla una secuencia que establece varios modos separados por punto y coma. El emulador recibe los bytes, pero la representación paralela de modos queda desactualizada.

Superset usa el parser y los modos de xterm en su [ModeTracker][superset-modes], incluyendo restauración y desactivación de modos que quedaron activos. Ese patrón elimina la dependencia del corte de transporte. Su implementación también toca internos de xterm: copiarla literalmente introduciría una dependencia frágil; conviene preferir API pública y fijar versiones cuando sea inevitable usar internos.

La solución debe esperar a que el parser haya procesado el stream antes de serializar. El estado visual, los modos y el punto de reanudación deben corresponder al mismo momento.

Criterio de aceptación: para cada secuencia soportada, dividirla en cualquier posición produce el mismo estado final. Reattach, resize y cambio entre shell/TUI conservan cursor, pegado y teclado.

### 9. Los límites del sidecar no cubren toda la presión de memoria

Prioridad P1 para el transporte; P2 para ajustar capacidades con mediciones.

Dos hallazgos de código y una reproducción:

- `pendingBytes` cuenta unidades de string. Cien caracteres `界` reportan 100 mientras ocupan 300 bytes UTF-8. No es una medida de heap tampoco.
- La expulsión del ring solo considera sesiones inactivas. Treinta y tres rings activos de 8 MiB representan 264 MiB de capacidad, por encima del objetivo de 256 MiB, antes de contar sockets, strings y emuladores. Es un cálculo de capacidad, no una medición de RSS.
- [`broadcast`](../../apps/desktop/src/main/terminal/pty-sidecar-entry.ts) ignora el booleano de `client.write`. El límite de `pending` previo al flush no limita la cola interna del socket de un consumidor lento.

Superset tiene [pruebas específicas][superset-flow] para consumidor lento, desconexión mientras el PTY está pausado y suscriptor que nunca drena. Adoptaría estos escenarios y una política que evite que un cliente atascado perjudique indefinidamente al resto.

OpenChamber separa [historial saneado][openchamber-history] y [respuesta a consultas del terminal][openchamber-theme]. Esto da una implementación concreta a T184.2/T184.3: el replay no debería repetir consultas al nuevo renderer, y las consultas sin renderer necesitan un único responsable de respuesta.

Criterio de aceptación: prueba de salida abundante con un cliente lento y otro sano; límites medidos en bytes y colas observables; desconectar el cliente lento no congela la sesión. Registrar RSS, capacidad de rings y bytes en transporte como métricas distintas.

### 10. El evaluador necesita distinguir mala evidencia, error y rechazo

Prioridad P1 dentro de T184.7/T183.14. Confirmado en código.

El juez usa dos llamadas por evaluación, y por defecto hay tres jueces. El JSON inválido acaba en score 0. Si fallan solo algunos jueces, sus ceros entran al promedio. Eso puede enviar el pipeline a corregir código por un fallo de infraestructura o de formato.

También existe una decisión deliberada que debe hacerse visible: reanudar después de un `hold` se interpreta como aprobación humana. La aprobación debería quedar ligada a la evidencia revisada; un cambio posterior del diff debería invalidarla. No debe confundirse el botón de reintento por fallo del proveedor con el acto de aprobar código.

Propuesta: salidas validadas con esquema; estados distintos para evaluación válida, fallo de proveedor y evidencia insuficiente; mínimo de jueces válidos antes de decidir; veredictos persistidos por intento. Las pruebas deterministas y sus comandos deben aparecer antes que la puntuación del modelo en el informe.

El score debe presentarse como opinión del evaluador. Para convertirlo en una señal útil de calidad, compararlo con defectos encontrados por humanos y resultados de checks. Tres jueces del mismo modelo sobre una descripción comprimida no garantizan independencia ni corrección.

## Competencia: qué cambió y qué conviene aprender

La documentación anterior sirve como historial de decisiones. Sus afirmaciones de exclusividad requieren una nueva comparación antes de usarse en producto o marketing. Superset, Emdash, Jean, T3 Code, Proliferate y Conductor ya describen soporte para varios proveedores. La neutralidad sigue siendo valiosa, pero no basta para distinguir a Exegol. [Superset][superset], [Emdash][emdash], [Jean][jean], [T3 Code][t3], [Proliferate][proliferate], [Conductor][conductor].

| Referencia | Evidencia revisada | Aprendizaje aplicable | Límite de adopción |
|---|---|---|---|
| Superset | Documenta CLI, SDK, MCP, automatizaciones y acceso remoto; código y pruebas de terminal | API operativa coherente, pruebas del transporte, estados reconstruibles | No copiar su infraestructura remota completa antes de tener garantías locales |
| Emdash | Documenta SSH/SFTP, trackers y recorrido de PR; scheduler durable en código | Ejecuciones persistidas, cancelación, reconciliación y revisión conectada | No abrir diez integraciones al mismo tiempo |
| Jean | Documenta runtime headless; el cambio reciente permite elegir proveedor/modelo por investigación | Presets por tarea, elección de coste/esfuerzo y separación entre runtime y ventana | Su hook grande y sus efectos de UI no son un modelo de implementación para copiar |
| OpenChamber | Parser de historial y respuestas de tema/DA1 | Separar stream vivo, estado y replay; resolver consultas sin renderer | No importar toda su matriz de aplicaciones y relays |
| Proliferate | Código y pruebas de entregas concurrentes con leases y recuperación | Outbox durable, un ganador por claim, rechazo de workers antiguos | No añadir Postgres/control plane cloud para resolver un problema local de SQLite |
| Agent of Empires | Documenta TUI/web y aislamiento opcional; journal durable de movimientos | Operaciones recuperables que cruzan filesystem y estado de sesiones | No reemplazar el sidecar por tmux ni el frontend por otra pila |
| MCP Agent Mail | Reservas con TTL, renovación y liberación comprobadas en código | Claims temporales, diagnóstico y conciliación con artefactos de guardia | No heredar todas sus políticas automáticas ni su tamaño de implementación |
| Herdr | Runtime persistente, CLI/socket API y plugins documentados | Continuidad y control desde agentes como parte central del producto | La revisión documental no prueba ausencia de controles de seguridad actuales |
| T3 Code | Documenta desktop/web/móvil y varios proveedores | Continuidad entre superficies, sesiones estructuradas y uso de autenticación existente | No usar la descripción antigua de herramienta exclusiva de Codex |
| Conductor | Docs actuales y changelog hasta septiembre | Revisión y edición de diff, cola recuperable, contexto/esfuerzo, trabajo remoto | Sus capacidades documentadas no equivalen a una auditoría de código cerrado |

Conductor documenta edición directa en diffs, recuperación de mensajes y mejoras en workspaces cloud. Competir en número de paneles sería caro y poco específico. Una oportunidad más defendible es reducir el tiempo que una persona dedica a entender, verificar y recuperar el trabajo producido por agentes. Es una hipótesis de producto que debe medirse, no una exclusividad demostrada. [Changelog de Conductor][conductor-changelog].

Proliferate merece una corrección de método respecto de T183: la revisión de agosto advertía no dar por implementados triggers solo por el README. El checkout actual cambió considerablemente. Este informe verifica entregas durables; no repite como hecho actual que carezca de automatizaciones. Cada afirmación debe quedar asociada al commit estudiado.

## Features recomendadas y alcance de la primera entrega

### Revisión de cambios con evidencia completa

Extiende T130, T129, T142, T183.11 y T184.1.

Una tarea debería abrir una vista con objetivo, diff acumulado, archivos afectados, comandos ejecutados, resultado de checks y observaciones todavía abiertas. El usuario puede devolver una observación al agente con su contexto y revisar la corrección en el mismo sitio. El registro debe distinguir claramente proceso terminado, validación aprobada y cambio aceptado por una persona.

Primera entrega: archivos/artefactos persistidos por paso, manifest y referencias a evidencia; checks locales con salida acotada; revisión humana; exportación Markdown. Segunda entrega: PR y comentarios de GitHub, con un único agente de corrección por PR para evitar carreras. Conservar la autoría Git del usuario y las reglas actuales de atribución.

Métrica: minutos de revisión humana por cambio aceptado y proporción de correcciones que requieren reconstruir contexto manualmente. Comparar tareas similares y registrar dificultad; el tiempo de merge por sí solo depende de demasiadas variables.

### Centro de recuperación

Combina trabajo de T138, T170, T183, T184 y Doctor; no requiere otra arquitectura de terminal.

Mostrar por sesión si el proceso vive, si existe transcript, si hay snapshot utilizable y si hay cambios Git conservados. Ofrecer la acción adecuada: reattach, reanudar mediante el CLI o abrir el worktree para rescatar el trabajo. Las operaciones pendientes deberían tener un registro durable que permita reconciliarlas al arrancar.

El [journal de Agent of Empires][aoe-journal] guarda la intención antes de mover estado entre perfiles y valida su versión al recuperar. Para Exegol, el mismo principio sirve en creación/limpieza de worktrees y actualización del runtime. El journal no tiene que convertirse en un sistema global de event sourcing.

Métrica: recuperación completa en escenarios de cierre de ventana, caída de renderer, caída de main y pérdida del sidecar. Son fallos diferentes; ningún proceso puede sobrevivir al reinicio del sistema, aunque su sesión lógica pueda reconstruirse.

### Awareness y Owl sin modelo en la primera versión

Ya propuestos en T153 y `OWL_FLEET_WATCH.md`; la recomendación es reducir y ordenar el alcance.

Primera versión: tres señales comprobables, por ejemplo PR sin revisar, tarea marcada pendiente con evidencia de cierre y divergencia de versión entre manifiesto y documentación. Cada tarjeta muestra fuente, fecha, confianza y acción. Marcar como visto debe silenciarla hasta que cambie la evidencia.

Reutilizar el registro de proyectos, NotificationBus, memoria y MCP. El índice de código necesita primero las correcciones de completitud, modelo y alcance. No existe razón para instalar un modelo de varios GB para detectar que T45 espera un repositorio público que ya es público.

Métrica inicial propuesta: precisión de al menos 95% en 50 señales revisadas y cero repetición de una tarjeta sin cambios después de marcarla como vista. No es un nivel logrado todavía. Si la señal no tiene evidencia suficiente, se muestra como sugerencia.

### Memoria con procedencia y revisiones

Extiende T158, T164 y el estudio de Engram.

Mostrar quién estableció una decisión, cuándo, qué archivo/commit la respalda y qué revisión la reemplazó. Separar hechos declarados por el usuario, observaciones del agente y resultados derivados del código. El usuario debe poder corregir una memoria desde la misma vista que la explica.

Primera entrega: equivalencia conservadora, tema estable, relación explícita entre versiones y enlace a evidencia. Después, construir context packs pequeños con hechos vigentes y paths consultables bajo demanda. Reforzar una memoria porque se inyecta repetidamente no debería convertir una inferencia antigua en autoridad.

### Compatibilidad visible por proveedor

Extiende T163, T134 y T58; añade una forma de comprobarlos como producto.

En vez de un único indicador de proveedor instalado, mostrar capacidades verificadas: ejecución interactiva, resume, historial, señales de turno, MCP, salida estructurada y modo de permisos. Guardar la versión del CLI con la última comprobación. Una prueba de contrato pequeña permite detectar cambios de flags/configuración antes de que aparezcan como fallos de UX.

PTY sigue siendo el camino universal. Un adaptador estructurado se habilita para un proveedor donde pueda probarse una mejora concreta, conservando fallback explícito. No hace falta migrar todos los agentes a ACP a la vez.

Métrica: primer spawn exitoso, recuperación exitosa y porcentaje de estados detectados mediante señales deterministas, separados por proveedor y versión.

### Utilidades de IA con autenticación existente

Ya en T183.2, T184.11 y T122; recomendadas después de reparar la evidencia.

Commit messages, resúmenes y revisiones deberían poder usar un CLI ya autenticado cuando soporte ejecución headless adecuada. Ofrecer proveedor/modelo/esfuerzo por tipo de tarea, tomando la configuración por investigación de [Jean][jean-investigation] como referencia.

La selección debe ser explícita. Una suscripción existente sigue teniendo límites y no equivale a inferencia gratuita. El subprocess de utilidades necesita timeout, cancelación, salida validada y configuración acotada para evitar recursión de hooks o MCP.

Primera entrega: una utilidad, por ejemplo resumen de diff, con CLI autenticado y API key como alternativas visibles. Medir tasa de éxito y latencia antes de migrar el evaluador.

### Ocupación de contexto y uso bajo demanda

Ya en T183.1 y T184.12/T184.13.

Mostrar ocupación actual de contexto cuando el proveedor la exponga, separada de tokens acumulados y coste estimado. Cuando no haya lectura fiable, mostrar desconocido. No derivar ocupación de la suma de tokens de toda la sesión.

Reducir primero los prompts que Exegol controla: paths de artefactos, índice de contenido y fragmentos solicitados. La compactación del historial interno de un CLI pertenece a ese CLI; Exegol no puede prometer aplicarla sobre un loop que no controla.

Criterio de aceptación: una compactación reduce el indicador de ocupación sin reducir el gasto histórico; el usuario puede inspeccionar qué contexto adjuntó Exegol y de dónde salió.

### Coordinación con reservas temporales y confirmación explícita

Ya en T183.3-10, T170, T171 y T175.

Añadir expiración/renovación de claims, threads persistidos, confirmaciones explícitas cuando una tarea requiera recepción y fingerprint para idempotencia. La [implementación de reservas de MCP Agent Mail][mail-reservations] muestra TTL y renovación; las [pruebas de Proliferate][proliferate-concurrency] verifican que dos workers no consuman simultáneamente la misma entrega y que un lease vencido se recupere.

Un boundary observado demuestra que el receptor avanzó, no que entendió el contenido. Separar entrega, confirmación y ejecución. Para operaciones con efecto, usar entrega al menos una vez con deduplicación y estado durable; evitar prometer exactly-once de extremo a extremo.

Primera entrega: expiración + renovación + visualización de dueño y tiempo restante, manteniendo claims de paths concretos. Los globs pueden llegar después de definir claramente sus conflictos. Evitar que una reserva expirada autorice ciegamente a sobrescribir trabajo todavía activo.

### Continuidad remota gradual

Extiende T133, T94, T73 y T93. La competencia confirma que merece atención, pero conviene limitar el primer alcance.

Primero notificaciones remotas con contenido mínimo y enlace a la sesión. Después una vista autenticada de atención, con lectura de estado y respuestas acotadas. Finalmente control de workspaces remotos si el uso demuestra necesidad. [Jean][jean-headless], [Superset][superset] y [Agent of Empires][aoe] documentan rutas de acceso sin depender de la ventana principal.

La separación runtime/UI beneficia también a automatizaciones y Owl. Extraer primero scheduler, bus y recuperación a un servicio reutilizable; mantener Electron como cliente. No hace falta reescribir el frontend ni lanzar una app móvil nativa en esta etapa.

Criterio de aceptación: al cerrar la ventana, el trabajo que el producto promete mantener sigue siendo consultable. Las reconexiones conservan identidad, historial y estado de operaciones pendientes.

## Optimización: orden por mecanismo y medición

| Prioridad | Cambio | Por qué | Cómo decidir si funcionó |
|---|---|---|---|
| 1 | Control de flujo por consumidor | Evita acumulación en sockets y bloqueo compartido | Salida abundante, cliente lento/sano, bytes pendientes y RSS |
| 2 | Integridad del índice antes de acelerarlo | Un ranking rápido con vectores incompletos o mezclados sigue siendo incorrecto | Recuperación tras fallo, cambio de modelo y exclusión de paths |
| 3 | Usar batching existente con concurrencia limitada | `generateEmbeddingsBatch` ya existe; `indexProject` llama chunk por chunk | Llamadas, tiempo de indexado y latencia de UI con corpus fijo |
| 4 | Separar búsqueda costosa del main | `semanticSearch` carga todos los chunks y ordena todos los scores | P95 con 1k, 10k y 100k chunks sintéticos; tiempo ocupado del main |
| 5 | Actualización incremental por contenido/modelo/chunker | Evita reconstruir lo que no cambió y reutilizar lo que ya no sirve | Checkout, archivo tocado sin cambios, rename y cambio de modelo |
| 6 | Digest asíncrono y adaptador TRS probado | `computeDigest` usa ejecución síncrona de hasta 30s y una invocación `trs digest` que falló en las pruebas del entorno | Cancelación, timeout, resultado validado y UI utilizable durante refresh |
| 7 | Contexto por artefactos y consulta bajo demanda | Evita repetir diffs/transcripts grandes en cada paso | Tokens adjuntados por Exegol por tarea equivalente |
| 8 | Pool de renderers solo si el perfil lo exige | El benchmark anterior ya documenta liberación de WebGL oculto | Comparar 1, 4 y 9 terminales visibles antes de añadir otro sistema de estado |

La búsqueda tiene además una revisión de corrección pendiente: `new Float32Array(chunk.embedding.buffer)` no usa offset/longitud del Buffer. Debe comprobarse el comportamiento real del driver antes de declarar un defecto en producción. Es una hipótesis localizada, no uno de los siete problemas reproducidos.

En el digest, las pruebas emitieron `digest: NSS_Init failed`. Esto exige comprobar el contrato de la versión instalada de TRS y validar la salida; no basta con que un ejecutable termine con código cero. Ya existe fallback interno, así que no se afirma que el digest completo esté inutilizable.

## Backlog y documentación: decisiones que están impidiendo priorizar

El board tiene IDs duplicados con significados distintos:

| ID | Primer significado | Segundo significado |
|---|---|---|
| T156 | Dashboard global | Owl, collectors |
| T157 | Mensajería entre proveedores | Owl, síntesis |
| T158 | Memory Habit Protocol | Owl, exposición MCP |
| T160 | Alias de sesión | Council, ejecuciones estructuradas |

Un dependency graph basado solo en esos IDs ya es ambiguo. Conviene asignar IDs únicos conservando una tabla de equivalencias histórica, y enlazar cada tarea con el título/alcance hasta resolverlo.

También hay una decisión arquitectónica contradictoria: T153 exige un sidecar `llama-server` y descarta inferencia dentro de Electron; Owl plantea como objetivo `node-llama-cpp` en proceso. Recomiendo dejar la primera entrega sin modelo y documentar después una decisión común basada en aislamiento, cancelación, memoria y empaquetado. Mantener una abstracción de inferencia no resuelve por sí sola dónde vive el proceso.

T183 y T184 agrupan demasiados cambios independientes. Separar correcciones de terminal, integridad de evidencia, coordinación, utilidades IA y contexto permite probar y cerrar cada una. Una fuente de investigación puede respaldar diez tareas pequeñas sin convertirse en una única tarea de varias semanas.

Actualizar el estado de los problemas ya resueltos: el fallback OR de memoria existe en `memory/store.ts`, aunque la checklist conserva la observación antigua de búsqueda demasiado literal. Tampoco sigue siendo cierto que executor, migraciones y MCP carezcan de pruebas. La nueva deuda está en recorridos y mecanismos específicos, como muestran las reproducciones.

## Plan de trabajo propuesto

Estimaciones orientativas para una persona familiarizada con el código. Incluyen implementación y comprobaciones acotadas; no son compromisos de calendario ni suponen que pueda hacerse todo en paralelo.

| Orden | Entrega | Tamaño orientativo | Tareas existentes | Salida verificable |
|---|---|---|---|---|
| 1 | Evidencia correcta + lint real + checks de PR | 3-6 días | T184.1, T144, T45 | Pipeline con commits conserva diff; fallos reales bloquean checks |
| 2 | Scheduler con runs durables y finalización única | 3-6 días | T132 como consumidor posterior | Timeout, concurrencia, restart y dependencias tienen semántica probada |
| 3 | Terminal: parser, replay y control de flujo | 4-8 días | T138, T183, T184.2-4 | Matriz de secuencias y reconexión aprobada; colas acotadas |
| 4 | Memoria/indexador: integridad y alcance | 4-7 días | T153, T158, T164 | Recupera vectores fallidos, no mezcla modelos ni refuerza negaciones |
| 5 | Revisión con artefactos y validación visible | 5-10 días | T130, T129, T142, T183.11 | Tarea, diff, checks y devolución al agente en un recorrido |
| 6 | Awareness/Owl determinista | 4-7 días | T153 y tareas Owl por renumerar | Tres señales con evidencia y marcas visto/no visto |
| 7 | Una utilidad con CLI autenticado + contexto visible | 3-6 días | T183.1-2, T122, T184.11-12 | Elección de proveedor y ocupación sin confundir gasto |
| 8 | Notificación remota y diseño de runtime sin ventana | 3-5 días para notificaciones; spike aparte | T133, T94 | Atención remota útil, con alcance y autenticación definidos |

No ejecutaría las ocho entregas sin revisar resultados. Tras las primeras cuatro, una sesión de uso real con dos proveedores y dos proyectos debe decidir si la siguiente inversión va a revisión, Awareness o continuidad remota. La prioridad debe responder a dónde se pierde trabajo o tiempo humano.

Dejaría para después SDK de paneles, app móvil nativa, inferencia residente, atribución por hunk y catálogo amplio de integraciones. Cambiar Electron por Tauri o migrar React para igualar el stack de un competidor tampoco aborda los defectos encontrados. Las actualizaciones de dependencias sí requieren un ciclo propio de compatibilidad y seguridad, con alcance de T144.

## Validación de producto propuesta

Usar diez tareas reales, de dificultad comparable, alternando el flujo actual y el flujo con evidencia completa. Registrar también los casos fallidos; excluirlos produciría una lectura artificialmente favorable.

| Pregunta | Medida |
|---|---|
| ¿Cuánto tarda el usuario en comprender el resultado? | Tiempo hasta aceptar o emitir primera observación concreta |
| ¿Cuánto trabajo se pierde al interrumpir? | Runs recuperados con proceso/artefactos/estado consistentes |
| ¿Sirve el evaluador? | Acuerdo y desacuerdo con revisión humana, con ejemplos de falsos positivos y negativos |
| ¿Ayuda la memoria? | Decisiones recuperadas correctamente y memorias erróneas inyectadas |
| ¿Awareness merece atención? | Tarjetas aceptadas, descartadas y repetidas sin cambios |
| ¿Ayuda la coordinación? | Entregas confirmadas, conflictos evitados y tiempo bloqueado por claims obsoletos |
| ¿Necesitamos remoto? | Veces que una tarea quedó detenida esperando una respuesta fuera del desktop |

La propuesta de posicionamiento es: Exegol permite coordinar agentes de distintos proveedores y revisar qué hicieron, con evidencia y recuperación por tarea. Antes de publicarla como promesa, completar el recorrido de aceptación descrito. La disposición a pagar y el segmento comercial siguen sin investigarse con usuarios; no se infieren de estrellas GitHub ni de la lista de features.

## Evidencia de ejecución

| Comprobación | Resultado |
|---|---|
| `bun run test` | 61 archivos, 748 pruebas aprobadas; 4.26s en esta ejecución |
| `cargo test --offline` | 55 pruebas aprobadas |
| `bun run typecheck:node`, desde desktop | Aprobado, ejecución directa |
| `bun run typecheck:web`, desde desktop | Aprobado, ejecución directa |
| `bun run build` | Exit 0 mediante Turbo; posible reutilización de caché |
| `bun run lint` + inspección dry-run | Exit 0 sin scripts lint de workspaces |
| Biome 2.4.7 directo | 510 archivos, 1 error y 2 warnings, sin aplicar fixes |
| Siete probes temporales | 7/7 reproducciones observadas; mocks y datos sintéticos |
| GitHub | Repo público, 0 workflows, 0 releases devueltas, PR #114 abierta sin checks reportados |
| Nueve repos de referencia | Pull fast-forward exitoso; todos limpios al finalizar |

Las probes comprobaron: modos VT fragmentados/compuestos; unidades de `pendingBytes`; negación reforzada como memoria equivalente; embeddings fallidos no reintentados; caché no invalidada al cambiar de modelo; symlink externo indexado; timeout/finalización tardía del scheduler con doble resultado. El archivo temporal se retiró del código del proyecto; copia de sesión en `/tmp/exegol-audit-20260905.probes.test.ts`. Son reproducciones diagnósticas que afirman el comportamiento defectuoso actual, no tests de regresión listos para integrar.

Las pruebas base produjeron avisos del entorno inicialmente restringido y del comando digest, pese a aprobar. La parte de red se repitió cuando se habilitó acceso. No se ocultan esas limitaciones detrás de un resultado verde.

## Repos actualizados y fuentes

Raíz obtenida de `spark config`: `/Users/peluche/dPeluCheData/PROJECTS/dPeluChe/_code_/_repos_2_learn/github.com`.

| Repo | Antes | Después | Fecha del commit final |
|---|---|---|---|
| superset-sh/superset | `d1407b6a6` | `42bd65b92` | 2026-09-05 |
| generalaction/emdash | `583ab2bc8` | `26d25ee84` | 2026-09-05 |
| coollabsio/jean | `41390c61` | `b9330484` | 2026-09-02 |
| openchamber/openchamber | `486c66b0c` | `cb672cccf` | 2026-09-05 |
| agent-of-empires/agent-of-empires | `89faf444` | `eb0f3829` | 2026-09-05 |
| proliferate-ai/proliferate | `8f2dcd39e` | `74e1178cf` | 2026-08-28 |
| pingdotgg/t3code | `4ac094fef` | `cb9a69423` | 2026-09-05 |
| ogulcancelik/herdr | `1079fff4` | `6c52aad51` | 2026-09-05 |
| Dicklesworthstone/mcp_agent_mail_rust | `1b58caf1` | `f8f9d00e` | 2026-09-05 |

El repo local de Herdr conserva su ruta histórica; la página pública consultada redirige a `herdrdev/herdr`. Las referencias de implementación de este informe apuntan a commits concretos para que la próxima revisión no confunda el estado de septiembre con el de agosto.

Fuentes internas principales: [backlog](../TASK_TODO.md), [features](../PROJECT_DEFINITION/FEATURES.md), [release](../GUIDES/RELEASE.md), [benchmarks](BENCHMARKS.md), [auditoría de julio](CODE_HEALTH_AUDIT_2026_07.md), [competencia de julio](COMPETITIVE_REVIEW_2026_07.md), [actualización de agosto](COMPETITIVE_UPDATE_2026_08.md), [CocoIndex](COCOINDEX_2026_08.md), [Engram](ENGRAM_2026_08.md), [Council](../ARCHITECTURE/COUNCIL_BASE.md) y [Owl](../ARCHITECTURE/OWL_FLEET_WATCH.md).

[superset]: https://github.com/superset-sh/superset
[superset-flow]: https://github.com/superset-sh/superset/blob/42bd65b92c7c7e30187160af8c3fca49b0f7556a/packages/pty-daemon/test/flow-control.test.ts
[superset-modes]: https://github.com/superset-sh/superset/blob/42bd65b92c7c7e30187160af8c3fca49b0f7556a/packages/host-service/src/terminal/terminal-mode-tracker.ts
[emdash]: https://github.com/generalaction/emdash
[emdash-scheduler]: https://github.com/generalaction/emdash/blob/26d25ee843d1e7fdc7eb9d81fe823052fe48a890/packages/core/src/runtimes/automations/node/scheduling/scheduler.ts
[jean]: https://github.com/coollabsio/jean
[jean-headless]: https://github.com/coollabsio/jean/blob/b93304849d15475732e230314de270dbe1f9cb53/docs/headless-server.md
[jean-investigation]: https://github.com/coollabsio/jean/blob/b93304849d15475732e230314de270dbe1f9cb53/src/hooks/useBackgroundInvestigation.ts
[openchamber-history]: https://github.com/openchamber/openchamber/blob/cb672cccf1b6f07be875085a1a5124fa72423668/packages/web/server/lib/terminal/history.js
[openchamber-theme]: https://github.com/openchamber/openchamber/blob/cb672cccf1b6f07be875085a1a5124fa72423668/packages/web/server/lib/terminal/theme-response.js
[proliferate]: https://github.com/proliferate-ai/proliferate
[proliferate-concurrency]: https://github.com/proliferate-ai/proliferate/blob/74e1178cf3ecfbfc3ffeb8321f82c4a9bfce620f/anyharness/crates/anyharness-lib/src/app/tests/completion_delivery_crash_tests/concurrency.rs
[aoe]: https://github.com/agent-of-empires/agent-of-empires
[aoe-journal]: https://github.com/agent-of-empires/agent-of-empires/blob/eb0f3829db5e247e93fcbd2d8ec7a88d29d44ad2/src/session/move_journal.rs
[mail-reservations]: https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/f8f9d00eddaa29c05a2225eafe8054abff4ef052/crates/mcp-agent-mail-tools/src/reservations.rs
[t3]: https://github.com/pingdotgg/t3code
[conductor]: https://www.conductor.build/docs
[conductor-changelog]: https://www.conductor.build/changelog
