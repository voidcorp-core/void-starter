---
date: 2026-07-28
title: "Keep generated sources lint-stable at the longest accepted project name"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-28: Keep generated sources lint-stable at the longest accepted project name

- **Date:** 2026-07-28
- **Decision:** Generated TypeScript must already satisfy `biome check` for every project name the
  manifest schema accepts, not only for the short names the fixtures use. Where the project name
  reaches JSX, it is bound to a `PROJECT_NAME` module constant and rendered as `{PROJECT_NAME}`,
  so the emitted line length no longer varies with the name. A composition test runs the repository
  Biome binary over every generated `.ts`/`.tsx` file, for four profiles, with a 63-character name.
- **Why:** The DEV-474 canary was the first generated project whose name exceeded 34 characters,
  and its very first `bun run lint` failed. The home-page template inlined the name inside a JSX
  element already indented eight columns, so any name past that threshold pushed the line beyond
  the 100-column width and Biome demanded a break the generator never emitted. Every earlier canary
  passed only because `void-starter-canary-20260725` is 28 characters. A generated project whose
  lint gate fails on its first commit is broken on delivery: the CI the factory itself installs
  goes red before the consumer writes a line of code.
- **Rejected alternatives:**
  - Running `biome check --write` over the rendered tree at generation time: it would fix any
    future template drift too, but it makes the output depend on an external binary resolved at
    render time, and the receipt's SHA-256 digests would then attest a file the generator did not
    itself produce. Generation stays a pure function of the manifest.
  - Capping the project name well below the schema maximum: it hides the defect behind a limit no
    consumer can predict, and the same class of bug returns at the next template that interpolates
    a manifest value into JSX.
  - Asserting a maximum line width in the test instead of running Biome: the formatter, not a
    proxy rule, is what the generated project's lint gate actually runs. This canary exists
    precisely because a plausible-looking approximation had been trusted.
- **Acceptance evidence:** The test fails on all four profiles before the fix and passes after it.
  The regenerated canary passes `lint`, `type-check`, `test`, `knip` and `build` with exit code 0,
  where its first generation exited 1 on lint.
- **When to revisit:** Extend the same check to any future generated language surface (SQL, YAML,
  Markdown) that interpolates manifest values and has a formatter in the generated project's gate.
  The `biome.json` `$schema` pin drifting from the freshly resolved CLI patch is a separate,
  non-blocking `info` and belongs to the version-alignment policy (DEV-479).
- **Last revised:** 2026-09-02 (DEV-767). The check now runs one `biome check --write` child
  per profile over the generated sources materialized in a temporary directory, instead of one
  `--stdin-file-path` child per file, and both the child and the Vitest case carry an explicit,
  measured bound. The per-file spawns cost 700 to 2900 ms per profile under the root Turborepo
  fan-out and tripped Vitest's implicit 5 s default on a green tree, so every autopilot seal that
  ran the verify suite inherited the flake. Batching keeps the same binary, working directory and
  configuration; the count of files Biome reports is asserted against the count handed over, so a
  source the configuration would skip fails the gate instead of passing it vacuously. The
  alternative of raising the timeout alone was rejected: it hides the cost instead of removing it.
