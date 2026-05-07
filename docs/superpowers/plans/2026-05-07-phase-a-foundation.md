# Phase A: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the void-starter monorepo with shared config, tooling enforcement (Biome, Lefthook, knip, gitleaks, commitlint, Renovate), and the `@void/core` package providing logger, env validation, typed errors, security headers, rate-limit, sanitize helpers, and the `defineAction` Server Action wrapper.

**Architecture:** Monorepo using Turborepo 2.x for orchestration and Bun workspaces for dependency management. The `@void/config` package exposes shared TS/Biome/Vitest base configs. The `@void/core` package provides framework-agnostic primitives consumed by all other packages and apps. Internal packages export TS source directly (no build step) since Bun and Next.js 16 handle TS natively. Tooling runs at three layers: Biome on save (IDE), Lefthook on commit/push (local), GitHub Actions on PR (remote, deferred to Phase D).

**Tech Stack:** Bun 1.3.x, Turborepo 2.x, TypeScript 5.x strict, Biome, Lefthook, commitlint + conventional commits, knip, gitleaks, Renovate, Pino + pino-pretty, Zod, @t3-oss/env-nextjs, Vitest.

**Reference:** `context.md` (architecture spec), `starter-plan.md` Steps 0-3, `docs/DECISIONS.md` (decisions 01, 04, 05, 07).

**Pre-conditions verified:**
- Bun 1.3.13 installed at `~/.bun/bin/bun`
- Git initialized with two commits on `main` tracking `origin/main` (`voidcorp-core/void-starter`)
- Files already present: `context.md`, `starter-plan.md`, `LICENSE`, `README.md`, `docs/DECISIONS.md`

---

## Working rules during execution

- All `bun` invocations must succeed in PATH. If `bun: command not found`, run: `export PATH="$HOME/.bun/bin:$PATH"`
- Each task ends with a commit using conventional commits format
- After each task, push to `origin main` (`git push`)
- Never use `console.log` in committed code (use the logger once it exists; before it exists, no code needs logging)
- Never write em dashes in any file
- Read the linked official documentation before implementing the matching task

---

### Task 1: Root package.json with workspaces declaration

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create the root package.json**

Create `/Users/folpe/Developer/void-starter/package.json`:

```json
{
  "name": "void-starter",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.3.13",
  "workspaces": [
    "apps/*",
    "packages/*",
    "_modules/*"
  ],
  "engines": {
    "bun": ">=1.3.0",
    "node": ">=20"
  },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "type-check": "turbo run type-check",
    "test": "turbo run test"
  }
}
```

- [ ] **Step 2: Verify JSON is valid**

Run: `bun -e "JSON.parse(await Bun.file('package.json').text()); console.log('ok')"`
Expected output: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add root package.json with bun workspaces"
git push
```

---

### Task 2: bunfig.toml

**Files:**
- Create: `bunfig.toml`

- [ ] **Step 1: Create bunfig.toml**

Create `/Users/folpe/Developer/void-starter/bunfig.toml`:

```toml
[install]
# Use exact versions for reproducibility in starter
exact = false
# Hoist all workspace deps to root node_modules
linker = "hoisted"

[install.scopes]
# No private registries at J0
```

- [ ] **Step 2: Commit**

```bash
git add bunfig.toml
git commit -m "chore: add bunfig.toml with hoisted linker"
git push
```

---

### Task 3: Root .gitignore

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Create .gitignore**

Create `/Users/folpe/Developer/void-starter/.gitignore`:

```
# Dependencies
node_modules/
.pnp
.pnp.js

# Build outputs
dist/
build/
.next/
out/
*.tsbuildinfo

# Turborepo
.turbo/

# Test outputs
coverage/
*.lcov
.vitest-cache/

# Env
.env
.env.local
.env.*.local
!.env.example

# Editor
.idea/
*.swp
*.swo
.DS_Store

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
bun-debug.log*

# Lefthook
.lefthook-local.yml
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add gitignore"
git push
```

---

### Task 4: Install Turborepo and create turbo.json

**Files:**
- Create: `turbo.json`
- Modify: `package.json` (deps via bun add)

- [ ] **Step 1: Install Turborepo as root dev dependency**

Run: `bun add -D turbo`
Expected: a `devDependencies` block added to `package.json` with `turbo`, and a `bun.lockb` file created.

- [ ] **Step 2: Create turbo.json**

Create `/Users/folpe/Developer/void-starter/turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^lint"],
      "outputs": []
    },
    "type-check": {
      "dependsOn": ["^type-check"],
      "outputs": []
    },
    "test": {
      "dependsOn": ["^test"],
      "outputs": ["coverage/**"]
    }
  }
}
```

- [ ] **Step 3: Verify Turborepo recognizes the config**

Run: `bunx turbo run lint --dry-run`
Expected: output shows the task graph with no tasks scheduled (no packages yet have a `lint` script). No JSON parse errors.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lockb turbo.json
git commit -m "chore: install Turborepo and add turbo.json pipeline"
git push
```

---

### Task 5: Create the directory skeleton

**Files:**
- Create: `apps/.gitkeep`, `packages/.gitkeep`, `_modules/.gitkeep`, `tooling/.gitkeep`

- [ ] **Step 1: Create directories with .gitkeep so git tracks them**

Run:
```bash
mkdir -p apps packages _modules tooling
touch apps/.gitkeep packages/.gitkeep _modules/.gitkeep tooling/.gitkeep
```

- [ ] **Step 2: Verify directories exist**

Run: `ls -la apps packages _modules tooling`
Expected: each directory listed with a `.gitkeep` file inside.

- [ ] **Step 3: Commit**

```bash
git add apps packages _modules tooling
git commit -m "chore: scaffold workspace directories"
git push
```

---

### Task 6: Create @void/config package skeleton

**Files:**
- Create: `packages/config/package.json`

- [ ] **Step 1: Create the package.json**

Create `/Users/folpe/Developer/void-starter/packages/config/package.json`:

```json
{
  "name": "@void/config",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "files": [
    "tsconfig.base.json",
    "tsconfig.lib.json",
    "tsconfig.next.json",
    "biome.base.json",
    "vitest.base.ts"
  ],
  "exports": {
    "./tsconfig.base.json": "./tsconfig.base.json",
    "./tsconfig.lib.json": "./tsconfig.lib.json",
    "./tsconfig.next.json": "./tsconfig.next.json",
    "./biome.base.json": "./biome.base.json",
    "./vitest.base": "./vitest.base.ts"
  }
}
```

- [ ] **Step 2: Run bun install to register the workspace**

Run: `bun install`
Expected: `bun install` completes; `node_modules/@void/config` symlink exists.

- [ ] **Step 3: Verify the workspace is linked**

Run: `ls -la node_modules/@void/`
Expected: `config` listed as a symlink to `../../packages/config`.

- [ ] **Step 4: Commit**

```bash
git add packages/config/package.json bun.lockb
git commit -m "chore(config): add @void/config workspace package skeleton"
git push
```

---

### Task 7: Shared tsconfig.base.json

**Files:**
- Create: `packages/config/tsconfig.base.json`

- [ ] **Step 1: Create the base TS config**

Create `/Users/folpe/Developer/void-starter/packages/config/tsconfig.base.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/config/tsconfig.base.json
git commit -m "chore(config): add tsconfig.base.json with strict TS rules"
git push
```

---

### Task 8: tsconfig.lib.json for library packages

**Files:**
- Create: `packages/config/tsconfig.lib.json`

- [ ] **Step 1: Create the lib TS config**

Create `/Users/folpe/Developer/void-starter/packages/config/tsconfig.lib.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noEmit": true
  }
}
```

Note: `noEmit: true` because internal packages are consumed as TS source directly. Bun and Next.js handle TS natively, so we never run `tsc` to emit JS for internal packages. The `tsc --noEmit` is only used for type-checking.

- [ ] **Step 2: Commit**

```bash
git add packages/config/tsconfig.lib.json
git commit -m "chore(config): add tsconfig.lib.json for library packages"
git push
```

---

### Task 9: tsconfig.next.json for Next.js apps

**Files:**
- Create: `packages/config/tsconfig.next.json`

- [ ] **Step 1: Create the Next.js TS config**

Create `/Users/folpe/Developer/void-starter/packages/config/tsconfig.next.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "incremental": true,
    "noEmit": true,
    "plugins": [{ "name": "next" }]
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/config/tsconfig.next.json
git commit -m "chore(config): add tsconfig.next.json for Next.js apps"
git push
```

---

### Task 10: biome.base.json shared rules

**Files:**
- Create: `packages/config/biome.base.json`

- [ ] **Step 1: Read the Biome official documentation**

Open in browser or read via gh / curl: `https://biomejs.dev/reference/configuration/`
Confirm the schema URL and the names of the rules used below match the current Biome version (~2.x in 2026).

- [ ] **Step 2: Create the shared Biome config**

Create `/Users/folpe/Developer/void-starter/packages/config/biome.base.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": true,
    "ignore": [
      "**/.next/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/node_modules/**"
    ]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": { "noBannedTypes": "error" },
      "correctness": { "noUnusedImports": "error", "noUnusedVariables": "error" },
      "style": {
        "useImportType": "error",
        "useExportType": "error",
        "noNonNullAssertion": "warn"
      },
      "suspicious": { "noConsoleLog": "error" }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all",
      "semicolons": "always",
      "arrowParentheses": "always",
      "bracketSpacing": true
    }
  },
  "json": {
    "formatter": { "trailingCommas": "none" }
  },
  "organizeImports": { "enabled": true }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/config/biome.base.json
git commit -m "chore(config): add biome.base.json with shared lint and format rules"
git push
```

---

### Task 11: vitest.base.ts shared test config

**Files:**
- Create: `packages/config/vitest.base.ts`

- [ ] **Step 1: Create the shared Vitest base**

Create `/Users/folpe/Developer/void-starter/packages/config/vitest.base.ts`:

```ts
import { defineConfig } from 'vitest/config';

export const baseConfig = defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/config/vitest.base.ts
git commit -m "chore(config): add vitest.base.ts shared test config"
git push
```

---

### Task 12: Root biome.json + install Biome + scripts

**Files:**
- Create: `biome.json`
- Modify: `package.json` (deps + scripts)

- [ ] **Step 1: Install Biome at root**

Run: `bun add -D @biomejs/biome`
Expected: `@biomejs/biome` added under `devDependencies` in root `package.json`.

- [ ] **Step 2: Create root biome.json extending the shared base**

Create `/Users/folpe/Developer/void-starter/biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "extends": ["./packages/config/biome.base.json"]
}
```

- [ ] **Step 3: Add lint scripts to root package.json**

Modify `package.json` `scripts` block to include:

```json
{
  "lint": "biome check .",
  "lint:fix": "biome check --write .",
  "format": "biome format --write .",
  "format:check": "biome format ."
}
```

(Replace the existing `"lint": "turbo run lint"` only after Task 19, so for now KEEP both. Actually overwrite turbo.run lint with the direct biome version since we lint at root, not per-package.)

The final `scripts` block becomes:

```json
{
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "format:check": "biome format .",
    "type-check": "turbo run type-check",
    "test": "turbo run test"
  }
}
```

- [ ] **Step 4: Verify Biome runs**

Run: `bun run lint`
Expected: Biome runs and reports zero errors (the existing `.md`, `.json`, `.toml` files are fine; no JS/TS code yet).

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lockb biome.json
git commit -m "chore: install Biome and wire lint/format scripts"
git push
```

---

### Task 13: Install Lefthook and configure git hooks

**Files:**
- Create: `lefthook.yml`
- Modify: `package.json` (dep)

- [ ] **Step 1: Read the Lefthook documentation**

Reference: `https://lefthook.dev/configuration/index.html`

- [ ] **Step 2: Install Lefthook**

Run: `bun add -D lefthook`
Expected: `lefthook` added under `devDependencies`.

- [ ] **Step 3: Create lefthook.yml**

Create `/Users/folpe/Developer/void-starter/lefthook.yml`:

```yaml
pre-commit:
  parallel: true
  commands:
    biome:
      glob: "*.{js,ts,jsx,tsx,json,md}"
      run: bunx biome check --staged --no-errors-on-unmatched {staged_files}
    type-check:
      glob: "*.{ts,tsx}"
      run: bunx tsc --noEmit
    gitleaks:
      run: bunx gitleaks protect --staged --redact

pre-push:
  commands:
    knip:
      run: bunx knip --no-progress

commit-msg:
  commands:
    commitlint:
      run: bunx commitlint --edit {1}
```

- [ ] **Step 4: Install hooks**

Run: `bunx lefthook install`
Expected: `sync hooks: ✔️ (pre-commit, pre-push, commit-msg)` or similar success output. `.git/hooks/pre-commit` exists.

- [ ] **Step 5: Verify hook script exists**

Run: `cat .git/hooks/pre-commit | head -3`
Expected: shebang and Lefthook invocation visible.

- [ ] **Step 6: Commit**

```bash
git add lefthook.yml package.json bun.lockb
git commit -m "chore: install Lefthook and configure git hooks"
git push
```

Note: this commit will trigger the hooks themselves. They may fail because `commitlint`, `knip`, and `gitleaks` are not yet installed. Expected for now: this commit either skips those hooks gracefully or fails, in which case install the missing tools in the next tasks then retry. If the commit fails, do not bypass with `--no-verify`; instead skip ahead to Task 14, 15, 16 and return to commit Task 13's changes after.

If the commit fails: run the next 3 tasks (commitlint, knip, gitleaks installs) FIRST, batched into one commit message: `chore: install Lefthook + commitlint + knip + gitleaks`.

---

### Task 14: Install commitlint and config

**Files:**
- Create: `commitlint.config.cjs`
- Modify: `package.json` (deps)

- [ ] **Step 1: Install commitlint**

Run: `bun add -D @commitlint/cli @commitlint/config-conventional`
Expected: both packages added under `devDependencies`.

- [ ] **Step 2: Create commitlint.config.cjs**

Create `/Users/folpe/Developer/void-starter/commitlint.config.cjs`:

```js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 200],
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'chore', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'revert'],
    ],
  },
};
```

- [ ] **Step 3: Verify commitlint reads its config**

Run: `echo "feat: dummy" | bunx commitlint`
Expected: no output (success).

Run: `echo "BAD: dummy" | bunx commitlint`
Expected: non-zero exit, error about `type-enum`.

- [ ] **Step 4: Commit**

```bash
git add commitlint.config.cjs package.json bun.lockb
git commit -m "chore: install commitlint with conventional commits config"
git push
```

---

### Task 15: Install knip with workspace-aware config

**Files:**
- Create: `knip.json`
- Modify: `package.json` (dep)

- [ ] **Step 1: Read knip workspaces documentation**

Reference: `https://knip.dev/features/monorepos`

- [ ] **Step 2: Install knip**

Run: `bun add -D knip`
Expected: `knip` added under `devDependencies`.

- [ ] **Step 3: Create knip.json**

Create `/Users/folpe/Developer/void-starter/knip.json`:

```json
{
  "$schema": "https://unpkg.com/knip@5/schema.json",
  "workspaces": {
    "packages/*": {
      "entry": "src/index.ts",
      "project": "src/**/*.ts"
    },
    "apps/*": {
      "entry": ["src/app/**/page.tsx", "src/app/**/layout.tsx", "src/app/**/route.ts", "src/middleware.ts", "src/instrumentation.ts", "next.config.ts"],
      "project": "src/**/*.{ts,tsx}"
    }
  },
  "ignore": ["**/*.test.ts", "**/_examples/**"],
  "ignoreDependencies": []
}
```

- [ ] **Step 4: Verify knip parses the config**

Run: `bunx knip --no-progress`
Expected: knip runs (may report zero or some unused items in current empty state); no JSON parse errors.

- [ ] **Step 5: Commit**

```bash
git add knip.json package.json bun.lockb
git commit -m "chore: install knip with workspace-aware config"
git push
```

---

### Task 16: Configure gitleaks

**Files:**
- Create: `.gitleaks.toml`

- [ ] **Step 1: Verify gitleaks is reachable via bunx**

Run: `bunx gitleaks version 2>&1 | head -3`
Expected: a version string or instructions; if not found, install via `bun add -D gitleaks` (the npm wrapper) or via Homebrew with `brew install gitleaks`. Prefer `bun add -D gitleaks` for cross-platform.

If `bun add -D gitleaks` fails because no npm package matches, use the Homebrew install: `brew install gitleaks` and document this in `docs/PATTERNS.md` later (Phase D).

- [ ] **Step 2: Create .gitleaks.toml with default rules**

Create `/Users/folpe/Developer/void-starter/.gitleaks.toml`:

```toml
title = "void-starter gitleaks config"

[extend]
useDefault = true

[allowlist]
description = "Repo-level allowlist for placeholders that look like secrets"
paths = [
  '''docs/.*\.md$''',
  '''CLAUDE\.md$''',
  '''README\.md$''',
]
regexes = [
  '''EXAMPLE_API_KEY''',
  '''YOUR_DSN_HERE''',
]
```

- [ ] **Step 3: Verify gitleaks runs**

Run: `bunx gitleaks detect --no-git --redact 2>&1 | tail -5`
Expected: scans the working tree, reports zero leaks (the docs are clean).

- [ ] **Step 4: Commit**

```bash
git add .gitleaks.toml
git commit -m "chore: configure gitleaks with default rules and doc allowlist"
git push
```

---

### Task 17: Renovate config

**Files:**
- Create: `renovate.json`

- [ ] **Step 1: Read Renovate docs for monorepo defaults**

Reference: `https://docs.renovatebot.com/configuration-options/`

- [ ] **Step 2: Create renovate.json**

Create `/Users/folpe/Developer/void-starter/renovate.json`:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:recommended",
    ":semanticCommits",
    ":semanticCommitTypeAll(chore)"
  ],
  "schedule": ["before 6am on monday"],
  "timezone": "Europe/Paris",
  "rangeStrategy": "bump",
  "lockFileMaintenance": {
    "enabled": true,
    "schedule": ["before 6am on monday"]
  },
  "automerge": false,
  "packageRules": [
    {
      "matchUpdateTypes": ["patch", "pin", "digest"],
      "automerge": true
    },
    {
      "matchPackagePatterns": ["^next$", "^react$", "^react-dom$"],
      "groupName": "Next.js + React"
    },
    {
      "matchPackagePatterns": ["^@tailwindcss/", "^tailwindcss$"],
      "groupName": "Tailwind ecosystem"
    },
    {
      "matchDepTypes": ["devDependencies"],
      "groupName": "dev dependencies (non-major)",
      "matchUpdateTypes": ["minor", "patch"]
    },
    {
      "matchPackagePatterns": ["^@biomejs/", "^lefthook$", "^knip$", "^gitleaks$"],
      "groupName": "tooling"
    }
  ]
}
```

- [ ] **Step 3: Validate JSON**

Run: `bun -e "JSON.parse(await Bun.file('renovate.json').text()); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add renovate.json
git commit -m "chore: add Renovate config with monorepo grouping and weekly schedule"
git push
```

---

### Task 18: Smoke-test Lefthook end-to-end

**Files:** none modified, manual verification only.

- [ ] **Step 1: Stage a known-bad commit message**

Make a trivial whitespace change in `README.md`, stage it:

```bash
echo "" >> README.md
git add README.md
```

- [ ] **Step 2: Attempt a commit with a non-conventional message**

Run: `git commit -m "BAD COMMIT"`
Expected: commit-msg hook fails via commitlint with a clear error about `type-enum`.

- [ ] **Step 3: Retry with a valid conventional message**

Run: `git commit -m "chore: trigger lefthook smoke test"`
Expected: hooks run (biome staged, tsc, gitleaks), all pass, commit succeeds.

- [ ] **Step 4: Push**

Run: `git push`
Expected: pre-push runs `knip`, then push succeeds.

- [ ] **Step 5: Revert the smoke-test change so README stays clean**

```bash
git revert HEAD --no-edit
git push
```

This proves the hook chain works end-to-end.

---

### Task 19: @void/core package skeleton

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/vitest.config.ts`

- [ ] **Step 1: Create the package.json**

Create `/Users/folpe/Developer/void-starter/packages/core/package.json`:

```json
{
  "name": "@void/core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./logger": "./src/logger.ts",
    "./env": "./src/env.ts",
    "./errors": "./src/errors.ts",
    "./server-action": "./src/server-action.ts",
    "./security-headers": "./src/security-headers.ts",
    "./rate-limit": "./src/rate-limit.ts",
    "./sanitize": "./src/sanitize.ts"
  },
  "scripts": {
    "lint": "biome check .",
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@t3-oss/env-nextjs": "^0.11.0",
    "pino": "^9.5.0",
    "pino-pretty": "^11.3.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `/Users/folpe/Developer/void-starter/packages/core/tsconfig.json`:

```json
{
  "extends": "@void/config/tsconfig.lib.json",
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "**/*.test.ts"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

Create `/Users/folpe/Developer/void-starter/packages/core/vitest.config.ts`:

```ts
import { baseConfig } from '@void/config/vitest.base';

export default baseConfig;
```

- [ ] **Step 4: Create src/index.ts placeholder**

Create `/Users/folpe/Developer/void-starter/packages/core/src/index.ts`:

```ts
// @void/core public API. Sub-paths (./logger, ./env, etc.) are the canonical entrypoints.
export {};
```

- [ ] **Step 5: Run install and type-check**

Run: `bun install`
Expected: workspace deps resolved, `node_modules/@void/core` symlink exists.

Run: `cd packages/core && bunx tsc --noEmit && cd ../..`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/ bun.lockb package.json
git commit -m "feat(core): scaffold @void/core package skeleton"
git push
```

---

### Task 20: @void/core logger (TDD)

**Files:**
- Create: `packages/core/src/logger.ts`, `packages/core/src/logger.test.ts`

- [ ] **Step 1: Read Pino docs for the recommended Next.js setup**

Reference: `https://getpino.io/#/docs/api?id=options-object`. Confirm transport options for `pino-pretty` in dev.

- [ ] **Step 2: Write the failing test**

Create `/Users/folpe/Developer/void-starter/packages/core/src/logger.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { logger } from './logger';

describe('logger', () => {
  it('exposes the standard log levels', () => {
    expect(typeof logger.trace).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  it('has a level field that reflects the configured threshold', () => {
    expect(typeof logger.level).toBe('string');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/core && bunx vitest run src/logger.test.ts && cd ../..`
Expected: FAIL with `Cannot find module './logger'`.

- [ ] **Step 4: Implement the logger**

Create `/Users/folpe/Developer/void-starter/packages/core/src/logger.ts`:

```ts
import pino, { type Logger } from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const level = process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info');

export const logger: Logger = pino({
  level,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

export type { Logger };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && bunx vitest run src/logger.test.ts && cd ../..`
Expected: 2 tests passed.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/logger.ts packages/core/src/logger.test.ts
git commit -m "feat(core): add Pino logger with pretty transport in dev"
git push
```

---

### Task 21: @void/core errors (TDD)

**Files:**
- Create: `packages/core/src/errors.ts`, `packages/core/src/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/folpe/Developer/void-starter/packages/core/src/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  isAppError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from './errors';

describe('AppError', () => {
  it('captures code, status, and cause', () => {
    const cause = new Error('underlying');
    const err = new AppError({ message: 'boom', code: 'TEST', status: 418, cause });
    expect(err.message).toBe('boom');
    expect(err.code).toBe('TEST');
    expect(err.status).toBe(418);
    expect(err.cause).toBe(cause);
  });

  it('defaults status to 500 and code to APP_ERROR', () => {
    const err = new AppError({ message: 'boom' });
    expect(err.code).toBe('APP_ERROR');
    expect(err.status).toBe(500);
  });
});

describe('typed subclasses', () => {
  it('ValidationError uses status 400 and code VALIDATION', () => {
    const err = new ValidationError('invalid');
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION');
  });

  it('NotFoundError uses 404', () => {
    expect(new NotFoundError('missing').status).toBe(404);
  });

  it('UnauthorizedError uses 401', () => {
    expect(new UnauthorizedError('login required').status).toBe(401);
  });

  it('ForbiddenError uses 403', () => {
    expect(new ForbiddenError('no rights').status).toBe(403);
  });

  it('ConflictError uses 409', () => {
    expect(new ConflictError('dup').status).toBe(409);
  });
});

describe('isAppError', () => {
  it('returns true for AppError instances', () => {
    expect(isAppError(new AppError({ message: 'x' }))).toBe(true);
    expect(isAppError(new ValidationError('x'))).toBe(true);
  });

  it('returns false for plain errors and non-errors', () => {
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError('string')).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && bunx vitest run src/errors.test.ts && cd ../..`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement errors**

Create `/Users/folpe/Developer/void-starter/packages/core/src/errors.ts`:

```ts
type AppErrorOptions = {
  message: string;
  code?: string;
  status?: number;
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  override readonly cause: unknown;

  constructor({ message, code = 'APP_ERROR', status = 500, cause }: AppErrorOptions) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ message, code: 'VALIDATION', status: 400, cause });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ message, code: 'NOT_FOUND', status: 404, cause });
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ message, code: 'UNAUTHORIZED', status: 401, cause });
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ message, code: 'FORBIDDEN', status: 403, cause });
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ message, code: 'CONFLICT', status: 409, cause });
    this.name = 'ConflictError';
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bunx vitest run src/errors.test.ts && cd ../..`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/errors.ts packages/core/src/errors.test.ts
git commit -m "feat(core): add typed error primitives with AppError base and helpers"
git push
```

---

### Task 22: @void/core env validation with @t3-oss/env-nextjs

**Files:**
- Create: `packages/core/src/env.ts`, `packages/core/src/env.test.ts`

- [ ] **Step 1: Read @t3-oss/env-nextjs documentation**

Reference: `https://env.t3.gg/docs/nextjs`. Confirm the API of `createEnv`, the `runtimeEnv` requirement, and how `client` vars must be `NEXT_PUBLIC_*` prefixed.

- [ ] **Step 2: Write the failing test**

Create `/Users/folpe/Developer/void-starter/packages/core/src/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAppEnv } from './env';

describe('createAppEnv', () => {
  it('parses valid env successfully', () => {
    const env = createAppEnv({
      server: { LOG_LEVEL: z.enum(['debug', 'info']).default('info') },
      client: { NEXT_PUBLIC_APP_URL: z.string().url() },
      runtimeEnv: {
        LOG_LEVEL: 'debug',
        NEXT_PUBLIC_APP_URL: 'https://example.com',
      },
    });
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.NEXT_PUBLIC_APP_URL).toBe('https://example.com');
  });

  it('throws on invalid env', () => {
    expect(() =>
      createAppEnv({
        server: { LOG_LEVEL: z.enum(['debug', 'info']) },
        client: {},
        runtimeEnv: { LOG_LEVEL: 'invalid' },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/core && bunx vitest run src/env.test.ts && cd ../..`
Expected: FAIL with module not found.

- [ ] **Step 4: Implement env.ts**

Create `/Users/folpe/Developer/void-starter/packages/core/src/env.ts`:

```ts
import { createEnv } from '@t3-oss/env-nextjs';
import type { ZodType } from 'zod';

type EnvShape<TServer extends Record<string, ZodType>, TClient extends Record<string, ZodType>> = {
  server: TServer;
  client: TClient;
  runtimeEnv: Record<string, string | undefined>;
};

export function createAppEnv<
  TServer extends Record<string, ZodType>,
  TClient extends Record<string, ZodType>,
>({ server, client, runtimeEnv }: EnvShape<TServer, TClient>) {
  return createEnv({
    server,
    client,
    runtimeEnv,
    emptyStringAsUndefined: true,
    skipValidation: process.env.SKIP_ENV_VALIDATION === 'true',
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && bunx vitest run src/env.test.ts && cd ../..`
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/env.ts packages/core/src/env.test.ts
git commit -m "feat(core): add createAppEnv wrapper around @t3-oss/env-nextjs"
git push
```

---

### Task 23: @void/core sanitize helpers (TDD)

**Files:**
- Create: `packages/core/src/sanitize.ts`, `packages/core/src/sanitize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/folpe/Developer/void-starter/packages/core/src/sanitize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { maskEmail, truncate } from './sanitize';

describe('maskEmail', () => {
  it('masks the local part keeping first and last char', () => {
    expect(maskEmail('alice@example.com')).toBe('a***e@example.com');
  });

  it('handles short local parts', () => {
    expect(maskEmail('ab@example.com')).toBe('a*@example.com');
    expect(maskEmail('a@example.com')).toBe('*@example.com');
  });

  it('returns the input unchanged when not an email', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email');
  });
});

describe('truncate', () => {
  it('truncates strings longer than max with ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello...');
  });

  it('returns the original string when shorter or equal', () => {
    expect(truncate('hi', 10)).toBe('hi');
    expect(truncate('hi', 2)).toBe('hi');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && bunx vitest run src/sanitize.test.ts && cd ../..`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement sanitize**

Create `/Users/folpe/Developer/void-starter/packages/core/src/sanitize.ts`:

```ts
export function maskEmail(input: string): string {
  const at = input.indexOf('@');
  if (at <= 0) return input;
  const local = input.slice(0, at);
  const domain = input.slice(at);
  if (local.length === 1) return `*${domain}`;
  if (local.length === 2) return `${local[0]}*${domain}`;
  return `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}${domain}`;
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}...`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bunx vitest run src/sanitize.test.ts && cd ../..`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sanitize.ts packages/core/src/sanitize.test.ts
git commit -m "feat(core): add maskEmail and truncate sanitize helpers"
git push
```

---

### Task 24: @void/core security-headers (TDD)

**Files:**
- Create: `packages/core/src/security-headers.ts`, `packages/core/src/security-headers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/folpe/Developer/void-starter/packages/core/src/security-headers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultSecurityHeaders } from './security-headers';

describe('defaultSecurityHeaders', () => {
  it('returns an array of header definitions for next.config headers()', () => {
    const headers = defaultSecurityHeaders();
    expect(Array.isArray(headers)).toBe(true);
    expect(headers.length).toBeGreaterThan(0);
  });

  it('includes HSTS, X-Frame-Options, X-Content-Type-Options, Permissions-Policy, Referrer-Policy', () => {
    const headers = defaultSecurityHeaders();
    const keys = headers.map((h) => h.key);
    expect(keys).toContain('Strict-Transport-Security');
    expect(keys).toContain('X-Frame-Options');
    expect(keys).toContain('X-Content-Type-Options');
    expect(keys).toContain('Permissions-Policy');
    expect(keys).toContain('Referrer-Policy');
  });

  it('uses DENY for X-Frame-Options', () => {
    const headers = defaultSecurityHeaders();
    const xfo = headers.find((h) => h.key === 'X-Frame-Options');
    expect(xfo?.value).toBe('DENY');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && bunx vitest run src/security-headers.test.ts && cd ../..`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement security headers**

Create `/Users/folpe/Developer/void-starter/packages/core/src/security-headers.ts`:

```ts
export type SecurityHeader = { key: string; value: string };

export function defaultSecurityHeaders(): SecurityHeader[] {
  return [
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    },
    { key: 'X-DNS-Prefetch-Control', value: 'on' },
  ];
}
```

Note: CSP is intentionally NOT in this default set. CSP is application-specific (depends on which scripts/styles/fonts the app loads). Each `apps/*` declares its own CSP in `next.config.ts` extending these defaults. This is documented in `docs/SECURITY.md` (Phase D).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bunx vitest run src/security-headers.test.ts && cd ../..`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security-headers.ts packages/core/src/security-headers.test.ts
git commit -m "feat(core): add default security headers (HSTS, XFO, Permissions-Policy, etc.)"
git push
```

---

### Task 25: @void/core rate-limit in-memory adapter (TDD)

**Files:**
- Create: `packages/core/src/rate-limit.ts`, `packages/core/src/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/folpe/Developer/void-starter/packages/core/src/rate-limit.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryRateLimit } from './rate-limit';

describe('createInMemoryRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to N requests in the window', async () => {
    const limit = createInMemoryRateLimit({ max: 3, windowMs: 1_000 });
    expect((await limit.check('user-1')).allowed).toBe(true);
    expect((await limit.check('user-1')).allowed).toBe(true);
    expect((await limit.check('user-1')).allowed).toBe(true);
  });

  it('blocks the next request after the cap', async () => {
    const limit = createInMemoryRateLimit({ max: 2, windowMs: 1_000 });
    await limit.check('user-1');
    await limit.check('user-1');
    const result = await limit.check('user-1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('isolates buckets by key', async () => {
    const limit = createInMemoryRateLimit({ max: 1, windowMs: 1_000 });
    expect((await limit.check('user-1')).allowed).toBe(true);
    expect((await limit.check('user-2')).allowed).toBe(true);
    expect((await limit.check('user-1')).allowed).toBe(false);
  });

  it('refills after the window elapses', async () => {
    const limit = createInMemoryRateLimit({ max: 1, windowMs: 1_000 });
    await limit.check('user-1');
    expect((await limit.check('user-1')).allowed).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect((await limit.check('user-1')).allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && bunx vitest run src/rate-limit.test.ts && cd ../..`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement rate-limit**

Create `/Users/folpe/Developer/void-starter/packages/core/src/rate-limit.ts`:

```ts
export type RateLimitConfig = {
  max: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

export type RateLimiter = {
  check: (key: string) => Promise<RateLimitResult>;
};

type Bucket = { count: number; resetAt: number };

export function createInMemoryRateLimit(config: RateLimitConfig): RateLimiter {
  const buckets = new Map<string, Bucket>();

  return {
    check: async (key) => {
      const now = Date.now();
      const bucket = buckets.get(key);

      if (!bucket || now >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + config.windowMs });
        return { allowed: true, remaining: config.max - 1, retryAfterMs: 0 };
      }

      if (bucket.count >= config.max) {
        return { allowed: false, remaining: 0, retryAfterMs: bucket.resetAt - now };
      }

      bucket.count += 1;
      return {
        allowed: true,
        remaining: config.max - bucket.count,
        retryAfterMs: 0,
      };
    },
  };
}
```

Note: this is intentionally in-memory. A distributed adapter (Upstash) lives in `_modules/rate-limit-upstash/` later. The shared `RateLimiter` interface lets the swap happen without changing call sites.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bunx vitest run src/rate-limit.test.ts && cd ../..`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rate-limit.ts packages/core/src/rate-limit.test.ts
git commit -m "feat(core): add in-memory rate limiter with RateLimiter interface"
git push
```

---

### Task 26: @void/core defineAction Server Action wrapper (TDD)

**Files:**
- Create: `packages/core/src/server-action.ts`, `packages/core/src/server-action.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/folpe/Developer/void-starter/packages/core/src/server-action.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ValidationError } from './errors';
import { defineAction } from './server-action';

describe('defineAction', () => {
  it('parses input via the Zod schema before calling handler', async () => {
    const handler = vi.fn(async (input: { name: string }) => ({ ok: true, name: input.name }));
    const action = defineAction({
      schema: z.object({ name: z.string().min(1) }),
      auth: 'public',
      handler,
    });

    const result = await action({ name: 'alice' });
    expect(handler).toHaveBeenCalledWith({ name: 'alice' }, expect.objectContaining({ user: null }));
    expect(result).toEqual({ ok: true, name: 'alice' });
  });

  it('rejects invalid input with a ValidationError', async () => {
    const handler = vi.fn();
    const action = defineAction({
      schema: z.object({ name: z.string().min(1) }),
      auth: 'public',
      handler,
    });

    await expect(action({ name: '' })).rejects.toBeInstanceOf(ValidationError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes ctx with null user when auth=public', async () => {
    const handler = vi.fn(async (_input: unknown, ctx: { user: unknown }) => ctx.user);
    const action = defineAction({
      schema: z.object({}),
      auth: 'public',
      handler,
    });

    const result = await action({});
    expect(result).toBeNull();
  });
});
```

Note: the `auth: 'required'` and `auth: 'role:admin'` paths cannot be tested at this point because `@void/auth` does not exist yet. Phase B will extend this test file to cover them after `@void/auth` is in place.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && bunx vitest run src/server-action.test.ts && cd ../..`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement defineAction**

Create `/Users/folpe/Developer/void-starter/packages/core/src/server-action.ts`:

```ts
import type { ZodType, infer as zInfer } from 'zod';
import { ValidationError } from './errors';
import { logger } from './logger';

export type ActionAuth = 'public' | 'required' | `role:${string}`;

export type ActionContext = {
  user: { id: string; role: string } | null;
};

type DefineActionConfig<TSchema extends ZodType, TResult> = {
  schema: TSchema;
  auth: ActionAuth;
  handler: (input: zInfer<TSchema>, ctx: ActionContext) => Promise<TResult>;
};

// Phase A scaffolding: auth resolution stub. Phase B replaces this with a real
// import from @void/auth. Anything other than 'public' will throw at call time
// until then.
async function resolveAuth(auth: ActionAuth): Promise<ActionContext> {
  if (auth === 'public') return { user: null };
  throw new Error(
    `defineAction: auth mode "${auth}" requires @void/auth, available in Phase B`,
  );
}

export function defineAction<TSchema extends ZodType, TResult>({
  schema,
  auth,
  handler,
}: DefineActionConfig<TSchema, TResult>) {
  return async function action(rawInput: unknown): Promise<TResult> {
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, 'action: validation failed');
      throw new ValidationError('Invalid input', parsed.error);
    }

    const ctx = await resolveAuth(auth);
    return handler(parsed.data, ctx);
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bunx vitest run src/server-action.test.ts && cd ../..`
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server-action.ts packages/core/src/server-action.test.ts
git commit -m "feat(core): add defineAction Server Action wrapper with auth scaffolding"
git push
```

---

### Task 27: @void/core barrel exports

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Update the index to re-export the public surface**

Replace the contents of `/Users/folpe/Developer/void-starter/packages/core/src/index.ts` with:

```ts
export { logger, type Logger } from './logger';
export {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  isAppError,
} from './errors';
export { createAppEnv } from './env';
export { defaultSecurityHeaders, type SecurityHeader } from './security-headers';
export {
  createInMemoryRateLimit,
  type RateLimitConfig,
  type RateLimitResult,
  type RateLimiter,
} from './rate-limit';
export { maskEmail, truncate } from './sanitize';
export {
  defineAction,
  type ActionAuth,
  type ActionContext,
} from './server-action';
```

- [ ] **Step 2: Type-check the package**

Run: `cd packages/core && bunx tsc --noEmit && cd ../..`
Expected: zero errors.

- [ ] **Step 3: Run the full core test suite**

Run: `cd packages/core && bunx vitest run && cd ../..`
Expected: all tests pass (logger 2 + errors 9 + env 2 + sanitize 5 + security-headers 3 + rate-limit 4 + server-action 3 = 28).

- [ ] **Step 4: Run knip to verify no unused exports**

Run: `bunx knip --no-progress`
Expected: zero issues for `@void/core` (every export is either used internally or exposed via public exports).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): expose public API via barrel export"
git push
```

---

### Task 28: Phase A end-to-end validation

**Files:** none modified, comprehensive verification only.

- [ ] **Step 1: Run lint at root**

Run: `bun run lint`
Expected: zero errors across the entire repo.

- [ ] **Step 2: Run type-check**

Run: `bun run type-check`
Expected: zero errors. Note: at this point, `apps/*` is empty, so Turborepo only runs type-check on `packages/core`.

- [ ] **Step 3: Run all tests**

Run: `bun run test`
Expected: 28 tests pass across `@void/core`.

- [ ] **Step 4: Run knip across the repo**

Run: `bunx knip --no-progress`
Expected: zero issues.

- [ ] **Step 5: Run gitleaks scan**

Run: `bunx gitleaks detect --no-git --redact`
Expected: zero leaks reported.

- [ ] **Step 6: Verify pre-commit hook still works**

Make a trivial change in any tracked file (e.g. add a blank line at the end of `README.md`), stage it, and attempt a commit with a valid conventional message:

```bash
echo "" >> README.md
git add README.md
git commit -m "chore: phase A validation smoke test"
```

Expected: hooks fire, all pass, commit succeeds. Then revert:

```bash
git revert HEAD --no-edit
git push
```

- [ ] **Step 7: Confirm directory state matches plan**

Run: `tree -I 'node_modules|.next|dist|.turbo' -L 3 -a`
Expected output should show:
- `apps/`, `packages/`, `_modules/`, `tooling/`, `docs/` directories
- `packages/config/` with the 5 config files
- `packages/core/` with `src/{index,logger,env,errors,security-headers,rate-limit,sanitize,server-action}.ts` and matching `.test.ts` files
- Root files: `package.json`, `bun.lockb`, `bunfig.toml`, `turbo.json`, `biome.json`, `lefthook.yml`, `commitlint.config.cjs`, `knip.json`, `.gitleaks.toml`, `renovate.json`, `LICENSE`, `README.md`, `context.md`, `starter-plan.md`, `.gitignore`

- [ ] **Step 8: Push and tag the phase**

```bash
git tag phase-a-complete
git push --tags
```

This tag is the safety net. Phase B starts from here.

---

## Phase A done. Next steps:

- Plan Phase B (`@void/db`, `@void/auth`, `@void/ui`) using the same writing-plans skill, informed by what we learned during Phase A execution
- Update `docs/DECISIONS.md` if any new non-obvious decision was taken during Phase A (none expected, but verify before moving on)
- If any tooling step revealed a config that needs adjustment, fix it in Phase B's first task and document the fix in the commit message

## Self-review notes

- Spec coverage: Steps 0, 1, 2, 3 of `starter-plan.md` are fully covered. Step 0 (bootstrap) = Tasks 1-5; Step 1 (config) = Tasks 6-11; Step 2 (tooling) = Tasks 12-18; Step 3 (core) = Tasks 19-27. Task 28 is the validation gate.
- No CSP in default headers because CSP is application-specific. Documented inline in Task 24 and deferred to `docs/SECURITY.md` (Phase D).
- gitleaks installation may require Homebrew on macOS if no compatible npm wrapper exists. Task 16 includes the fallback path.
- The `defineAction` `auth: 'required'` and `role:*` paths intentionally throw in Phase A; full coverage lands in Phase B once `@void/auth` is in.
