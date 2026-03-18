# Quality Review — Post-Implementation

> Usar cuando el agente reporta que terminó la implementación.
> Objetivo: asegurar que el código cumple las buenas prácticas del proyecto antes de validación técnica.

---

Ya terminaste la implementación. Ahora necesito que hagas una revisión exhaustiva de calidad antes de proceder al PR.

## Checklist de Revisión

### 1. LOC por archivo (MAX 400-500)
- Revisa TODOS los archivos que creaste o modificaste
- Si alguno supera 400 LOC, divídelo en módulos más pequeños
- Componentes UI: extraer sub-componentes si un archivo tiene más de 2 secciones lógicas
- Lógica de negocio: separar queries, helpers, types en archivos propios

### 2. Reutilización de componentes existentes
Revisa que estés usando los componentes de `@exegol/ui` y `components/common/` que ya existen:
- `EmptyState` — para estados vacíos (no crear divs ad-hoc)
- `LoadingSpinner` — para loading states
- `StatusDot` — para indicadores de estado
- `KeyValue` — para pares label/value
- `ConfirmDialog` — para confirmaciones destructivas
- `SidebarSection` — para secciones colapsables
- `Button, Badge, Input, ScrollArea, Separator, Tooltip` — de `@exegol/ui`
- `cn()` — de `@exegol/ui/lib/utils` para className merging

No reimplementes lo que ya existe. Busca en `components/common/index.ts` y `packages/ui/src/`.

### 3. Evaluación de useEffect
Para CADA useEffect que hayas escrito, evalúa con estas reglas del React team:
1. **¿Se puede derivar el estado?** Si el effect solo hace setState desde otro state/prop → reemplazar con cálculo inline o useMemo
2. **¿Es un fetch?** → Debería usar el patrón de tRPC hooks (use-trpc.ts), NO useEffect + fetch
3. **¿Es respuesta a acción del usuario?** → Mover a event handler, no effect
4. **¿Es sync con sistema externo (DOM, xterm, IPC)?** → OK usar useMountEffect de `hooks/use-mount-effect.ts`
5. **¿Usa key reset pattern?** → Preferir `key` prop sobre dependency arrays complejos

Si encuentras algún useEffect innecesario, elimínalo y usa el patrón correcto.

### 4. Patrones del proyecto
- **tRPC**: usar `trpcInvoke`/`trpcMutate` de `lib/trpc-client.ts`, no llamadas IPC directas
- **Zustand**: usar selectores granulares (no destructurar todo el store). Ejemplo: `useAgentStore(s => s.focusedAgentId)` no `const { focusedAgentId, agents, ... } = useAgentStore()`
- **Types**: compartir tipos via `@exegol/shared`, no redefinir en renderer
- **DB queries**: en archivos separados bajo `main/db/queries/`, no inline en procedures
- **IPC procedures**: en archivos propios bajo `main/ipc/procedures/`
- **Error handling**: try/catch en procedures, errores descriptivos, no silenciar excepciones
- **Naming**: camelCase para TS, snake_case para DB columns, PascalCase para components

### 5. Documentación
- Verifica que cada tarea completada tenga su `docs/applied/T{XX}_{name}.md`
- Cada doc debe incluir:
  - **Inspiration Source**: repo, files studied, pattern applied
  - **What Changed**: list of files created/modified
  - **Architecture Decisions**: why this approach, trade-offs considered
  - **How to Test**: manual testing steps

Haz las correcciones necesarias y dime qué cambiaste.
