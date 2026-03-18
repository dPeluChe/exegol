# Agent Prompts

Reusable prompts for the parallel agent workflow lifecycle.
Used sequentially by each agent upon completing their task cluster.

## Lifecycle

```
1. ASSIGNMENT   → Per-agent prompt (defined in TASK_TODO_V2.md)
2. REVIEW       → quality_review.md (after implementation is done)
3. PRE-PR       → pre_pr_validation.md (before creating the PR)
```

## Files

| Prompt | When to use | What it evaluates |
|--------|-------------|-------------------|
| `quality_review.md` | When the agent reports "done" | LOC limits, component reuse, useEffect rules, project patterns, docs |
| `pre_pr_validation.md` | After review corrections are applied | Lint 0/0, TypeScript build, Rust check, imports, clean files |
