# terragon-oss — post-mortem análisis 2026-07-09

Repo local: `_repos_2_learn/github.com/terragon-labs/terragon-oss` (143k LOC TS, shutdown feb 2026,
código liberado como snapshot) · Feeds **T142** (primario), T78/T135 (secundario).

**Qué era**: "prompt → sandbox cloud → PR". Next.js + Postgres/Drizzle + xstate (14 estados con
parking states por rate-limit — misma filosofía que nuestro T78), daemon Node dentro del sandbox
spawneando CLIs headless (`claude -p --output-format stream-json`), webhooks GitHub App.

**Post-mortem (lección estratégica)**: NO fue fallo de ingeniería (21 TODOs en 143k LOC, tests
serios). Murió por: (1) superficie SaaS — el core diferenciador (agente-en-PR) era ~20% del código,
el resto era "ser un SaaS" (billing, multi-tenancy, sandbox hibernation, 25 admin pages);
(2) costo cloud visible en todo el código; (3) moat delgado — su propio shutdown.mdx recomienda
Claude Code Web y Codex Web: los vendors shippearon el producto nativamente. **Validación directa
de nuestra postura local-first + neutralidad multi-provider.**

## Payload T142 — adoptar (con refs)

1. **Tabla `github_pr` casi verbatim** → libSQL: `github_prs(repo_full_name, number
   UNIQUE juntos, status, base_ref, mergeable_state, checks_status, agent_id nullable,
   updated_at)` + index. Provenance bidireccional; el link al thread creador NUNCA se
   sobreescribe en upsert (`packages/shared/src/model/github.ts:34-59`).
2. **Helpers de derivación puros** (`packages/shared/src/github-api/helpers.ts`) — portar
   los 3 tal cual: `getGithubPRStatus` (merged_at→merged, closed_at→closed, draft→draft),
   `getGithubPRMergeableState` (passthrough), `getGithubPRChecksStatus` (0 runs→none;
   any queued/in_progress→pending; any failure→failure; all success/neutral/skipped→success).
   Alimentar local desde `gh pr view --json` + `gh pr checks`.
3. **Dirty-check → push refresh** (`lib/github.ts:112`): fetch → comparar 4 campos vs DB →
   escribir + broadcast SOLO si cambió. Mapea 1:1 a nuestro push-first IPC
   (`broadcastPRStatus` hermano de `broadcastAgentStatus`).
4. **Receta review-comment → fix-agent** (`utils.ts:273-420`, `handle-app-mention.ts:159`):
   - `getDiffContextStr`: bloque ```diff sintético SOLO desde el payload (path, diff_hunk,
     line/side, "originally at line N") — sin API call extra
   - reply-chain walk hasta la raíz del thread (hasta 100 comments, cronológico)
   - prompt cierra con *"You can use the github cli to pull comments, reply, and push changes"*
     — delega el resto a `gh` dentro del agente
   - spawn en `pr.head.ref` en worktree; guardar `source_metadata {repo, prNumber, commentId}`
5. **Un-agente-por-PR + debounce**: reuso de thread (unarchived primero, más reciente) +
   batch key `github-mention:{repo}:{pr}` con ventana 60s — N comments alimentan UN agente
   como follow-ups encolados, no N agentes.
6. **"Fix CI" en una línea** (`fix-github-checks.ts:43`): mensaje al agente vivo — *'Please fix
   the failing GitHub checks for this PR. Use "gh pr checks" to get the failures.'* Cero
   plumbing de logs CI. Cablear al estado failing-checks del Smart Git Button.
7. **Idempotencia de PR + mantenimiento AI del body** (`agent/pull-request.ts:104-137,239-271`):
   `pulls.list({state:open, head})` con match exacto de head.ref antes de crear; gate
   `shouldUpdate` decidido por AI antes de reescribir; SIEMPRE re-inyectar deep-link a la
   task + issue ref si el modelo los tiró. Ya tenemos Haiku para commit msgs — añadir
   `generatePRContent`/`updatePRContent` con la misma key.
8. **Override de modelo en el comment**: `@app [sonnet] fix this` (`utils.ts:36`) — barato.
9. Menores: AI commit msg desde diff capado en bytes + `git fsck` (clones blobless corrompen);
   retry backoff mult 1.3 / jitter 0.3 / max 10 (`daemon/src/retry.ts`); test de authz que
   recorre todas las admin pages y asserta el guard (`admin.test.ts`).

## NO copiar (mismatch local-first)

- **GitHub App + webhook receiver** — requiere endpoint público. Nosotros: poll con el token
  de `gh auth` en focus + intervalo. PERO añadir lo que Terragon nunca necesitó: conditional
  requests (ETag) o UNA query GraphQL para PR+reviews+checks — un desktop haciendo REST sin
  cache revienta el límite de 5k/hr en repos activos.
- Token de instalación minteado por llamada sin cache — si usamos tokens, cachear con expiry.
- Doble identidad App/OAuth — localmente el login de `gh` del usuario es la identidad única
  correcta (autor del PR = humano, CODEOWNERS funciona).
- Check runs propios en PRs (requiere App auth) — un PR comment con el run report de T130
  logra lo mismo local.
- PartyKit, fan-out multi-user, billing gates, sandbox hibernation — artefactos de cloud tenancy.

## Señal extra (T135)

Sus parking states de rate-limit (`queued-agent-rate-limit` + `reattemptQueueAt` + parsers
`parseClaudeRateLimitMessage`/`parseCodexRateLimitMessage`) son un patrón para nuestro manejo
de rate limits de agentes — hoy no distinguimos "agente rate-limited" de "agente colgado".
