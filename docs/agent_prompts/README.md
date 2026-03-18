# Agent Prompts

Prompts reutilizables para el ciclo de trabajo con agentes paralelos.
Se usan en orden secuencial por cada agente al completar su cluster de tareas.

## Ciclo de vida

```
1. ASSIGNMENT   → Prompt de asignación (uno por agente, en TASK_TODO_V2.md)
2. REVIEW       → quality_review.md (al terminar implementación)
3. PRE-PR       → pre_pr_validation.md (antes de crear PR)
```

## Archivos

| Prompt | Cuándo usar | Qué evalúa |
|--------|-------------|-------------|
| `quality_review.md` | Cuando el agente dice "ya terminé" | LOC limits, reutilización, useEffect rules, patrones del proyecto, docs |
| `pre_pr_validation.md` | Después de correcciones de review | Lint 0/0, TypeScript build, Rust check, imports, archivos limpios |
