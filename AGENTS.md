# AGENTS.md

<!-- void-machine:begin -->

## Void Machine (managed by `void-machine init`)

Codex doctrine active in this project:

- `void` — universal craftsman skills (TDD, TypeScript strict, hexagonal, DDD, ...)
- `harness-monorepo` — Turborepo monorepo conventions
- `harness-react` — React 19 + shadcn/Radix + accessibility
- `harness-nextjs` — Next.js 16 App Router conventions
- `harness-server` — Server Actions, webhooks, Drizzle, Zod boundaries

### Doctrine — read at the start of every session

- `.void/installed/PHILOSOPHY.md`
- `.void/PROJECT-DOCTRINE.md`

`PHILOSOPHY.md` is the universal Void Machine doctrine (managed — overwritten on init). `PROJECT-DOCTRINE.md` holds project-specific rules: context, ADRs, in-flight decisions (yours; init never overwrites what you have written in it).

To capture a new rule, just say it ("ajoute la règle…", "always X here", "never Y"). The `void-learn` workflow classifies project-specific vs universal, proposes the wording, waits for your confirmation, then writes. Never silent.

Every skill is invoked by its name: `$void-implement`, `$void-tdd`. A skill that composes another names it the same way; the syntax is the runtime's, the name is the skill's.

### Program — when present

If `.void/program.md` exists with `status: executing`, read it and its linked plan/spec before choosing implementation work. The programme holds global context; the local checkpoint holds session residue, and `ResumeBundle` composes both with Git. On a continue/start/resume request without a named work unit, use the declared progress provider: recover the scoped unit if exactly one is started; if several are started, stop and surface the competing claims; otherwise select the first ready unit from the declared order and native blocker relations. Fetch the complete unit before running `void-implement`. The declared progress provider owns mutable execution state; the program and checkpoint never store a current or next unit. If the provider or a required capability is unavailable, do not infer remote progress; stop the action that needs it. If no progress provider is declared, require a specific unit instead of selecting one. A specific user request overrides selection; human gates and merges remain human. The file's `autopilot` block carries consent to autonomous execution and is never inferred: `enabled: false`, an absent block, or an unreadable one forbids autonomous selection entirely.

An authorized merge includes routine local synchronization by the coordinator without asking for confirmation again. Verify the branch, remote, and verified merged commit, then fetch and advance the clean local target branch with `git merge --ff-only` to that commit. Stop on local changes, divergence, or an unexpected remote tip; preserve the work. This does not authorize another remote merge, deployment, history rewrite, or changes to shared Git state by commit-only workers. Runtime sandbox and approval controls still apply; never bypass them.

Run `void-machine doctor` to verify the install.

<!-- void-machine:end -->

<!-- Your project-specific guidance goes below. -->
