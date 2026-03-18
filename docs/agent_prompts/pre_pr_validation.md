# Pre-PR Validation — Final Gate

> Usar después de que el agente completó el quality review y aplicó correcciones.
> Objetivo: confirmar que todo compila, lint pasa limpio, y los archivos están en orden antes de crear el PR.

---

Estamos a punto de crear el PR. Ejecuta la validación final completa.

## 1. Lint — debe dar 0 errors Y 0 warnings

```bash
npx @biomejs/biome check apps/ packages/shared/src/ packages/ui/src/
```

Si hay errores, corrígelos con:
```bash
npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/
```

Vuelve a correr el check después del fix para confirmar 0 errors, 0 warnings.

## 2. TypeScript — debe compilar sin errores

```bash
npx tsc --noEmit -p apps/desktop/tsconfig.node.json
npx tsc --noEmit -p apps/desktop/tsconfig.web.json
```

Si hay errores de tipos, corrígelos. **NO uses `@ts-ignore` ni `any` como escape.**

## 3. Rust (solo si tocaste packages/core-rust/)

```bash
cd packages/core-rust && cargo check
```

## 4. Verificación de imports
- No debe haber imports sin usar
- No debe haber variables sin usar (el linter los marca)
- Verificar que no importas desde rutas relativas que deberían ser `@exegol/shared` o `@exegol/ui`

## 5. Verificación de archivos

```bash
# Revisar que no hay archivos inesperados
git status

# Confirmar que solo tocaste archivos de tu cluster
git diff --stat main...HEAD
```

- No debe haber: console.log temporales, archivos .bak, archivos de debug
- Si modificaste archivos fuera de tu lista asignada, justifica por qué

## 6. Commits
- Asegúrate de que cada tarea tiene su propio commit descriptivo
- Formato: `feat: T{XX} — {descripción corta de lo implementado}`
- No squashees todo en un solo commit
- Verifica con `git log --oneline main...HEAD`

## 7. Resultado esperado

Muéstrame la salida de:
1. `npx @biomejs/biome check apps/ packages/shared/src/ packages/ui/src/` → 0 errors, 0 warnings
2. `npx tsc --noEmit -p apps/desktop/tsconfig.node.json` → clean
3. `npx tsc --noEmit -p apps/desktop/tsconfig.web.json` → clean
4. `git log --oneline main...HEAD` → commits por tarea
5. `git diff --stat main...HEAD` → solo archivos del cluster

Si todo pasa limpio, procedemos al PR.
