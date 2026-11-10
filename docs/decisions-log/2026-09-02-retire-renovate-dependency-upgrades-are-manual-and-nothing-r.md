---
date: 2026-09-02
title: "Retire Renovate; dependency upgrades are manual and nothing replaces the bot"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-09-02: Retire Renovate; dependency upgrades are manual and nothing replaces the bot

- **Date:** 2026-09-02
- **Decision:** `renovate.json` is deleted and the repository is removed from the Renovate GitHub
  App installation (the app-side removal is a human action, recorded on DEV-702). No bot opens
  dependency PRs, no patch is automerged, and no lockfile maintenance runs on a schedule. A
  dependency upgrade is now a pull request a maintainer opens on purpose, and it goes through the
  same CI as any other change. No replacement bot (Dependabot or another) is introduced.
  This entry supersedes the two places in this log that still described Renovate as active
  policy: the ADR 18 convention bullet "Renovate handles minor/patch upgrades automatically", and
  the "weekly dependency bump" / "ordinary weekly path" that ADR 71 relies on for revisiting the
  Better Auth pin. Their text stays as written, per the append-only rule of this file; the ADR 71
  revisit now happens when a maintainer chooses to open the bump. ADR 07 and ADR 29 name Renovate
  only inside their cost reasoning about phantom packages; that reasoning holds for any dependency
  bot and stays as historical rationale. `context.md` and `starter-plan.md`, the 2026-05-07
  brainstorm seed and its build plan, are frozen historical documents superseded by `README.md`
  and `docs/*.md`: each carries a banner saying so and is not rewritten.
- **Why:** Owner decision, 2026-09-01: Renovate is no longer part of the surface this repository
  maintains. The motive is recorded here as stated, not derived from the code, and this entry does
  not guess at one. What the decision costs is explicit: the repository loses proactive update
  PRs, grouped weekly bumps and the automerge of patch, pin and digest updates, and nothing
  replaces them. `bun audit` still blocks CI on published advisories, but it detects and does not
  upgrade; knip trims the surface and says nothing about freshness. Upgrades are manual and
  unscheduled until a later decision says otherwise.
- **Rejected alternatives:**
  - Keep Renovate with `automerge` off: removes the unreviewed lockfile rewrites but keeps the PR
    stream and the app's write access, which is the surface being retired.
  - Replace it with Dependabot or another bot: the same surface under another name, and explicitly
    out of scope of the retirement.
  - Delete the config but leave the repository in the app installation: Renovate then opens an
    onboarding PR against a repository that opted out. The app-side removal is part of the
    decision and is a human gate.
  - Write a manual review cadence here as the replacement control: nothing enforces it, so
    `docs/SECURITY.md` would claim a control that does not exist. The honest statement is that
    upgrades are manual and unscheduled.
- **Acceptance evidence:** `rg -n -i renovate` reviewed occurrence by occurrence on DEV-702: the
  normative surfaces (`README.md`, `docs/SECURITY.md`, `docs/MODULES.md`, `_modules/README.md`)
  no longer name Renovate; what remains is this entry, the superseded and historical ADR text,
  the frozen seed documents behind their banner, the Phase A plan under `docs/superpowers/plans/`
  and a handoff note that uses "auto-merge" about a git merge. `gh pr list --state open` on
  `voidcorp-core/void-starter` returned no pull request at the time of the change, and a search
  over all pull requests found none authored by Renovate. The installation scope could not be read
  from the repository (the API answered 401), so its removal is a human observation attached to
  the ticket.
- **When to revisit:** If the factory wants an update cadence again, that is a new ADR naming the
  bot, the automerge policy and who reviews the stream; do not reinstate `renovate.json` silently.
  Revisit also if `bun audit` starts failing CI repeatedly on transitive advisories a scheduled
  bump would have absorbed: that is the signal that the manual path costs more than the automated
  one did.
- **Last revised:** 2026-09-03 (DEV-702). The decision above says the repository "is removed from
  the Renovate GitHub App installation". That is inaccurate: there was no installation to remove.
  The organization's installed GitHub Apps were read on 2026-09-03 and carry Claude, Claude Design
  Import, Claude for GitHub, Vercel and voidcorp-release, with no Renovate and no pending
  installation request. Confirming it: no pull request in the repository's history has a bot for an
  author, and the weekly dependency bumps that ADR 71 calls "the ordinary weekly path" were each
  opened by hand. So `renovate.json` configured a bot that never had access to this repository, and
  what this entry retired was a dead configuration and the promises the documentation still made
  about it. Nothing else in the decision changes: there is no automated update mechanism, upgrades
  are manual and unscheduled, and `docs/SECURITY.md` describes that gap rather than a replacement
  control. The scope of an installation still cannot be read from the repository, since the API
  needs a GitHub App JWT and a user token answers 403, so this remains a human observation.
