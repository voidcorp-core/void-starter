# Proposed Linear backlog

Status: draft; review is required before any Linear write.

## Project

- Name: `Void Starter — Factory roadmap`
- Goal: finish the remaining provider adapters, remote validation profiles, orchestration links and
  productization decisions needed for a distributable Factory v1.
- Team, owner, dates, estimates and project status: resolve from Linear or leave unset; do not
  invent them.

## Milestone 1 — Provider coverage

1. **Implement the Cloudflare R2 adapter**
   - Add guarded plan, preflight, apply/resume, secret binding, receipts, doctor checks, contract
     tests and an isolated canary for EU-private document storage.
2. **Implement the Sentry provisioning adapter**
   - Provision and bind only the selected Sentry resources and public/runtime variables, with
     secret-safe receipts, recovery tests and a live canary.
3. **Implement the PostHog provisioning adapter**
   - Provision and bind the EU PostHog project/configuration selected by the manifest, with
     idempotence, recovery tests and a live canary.
4. **Implement the DNS adapter**
   - Plan and apply explicit DNS mutations with ownership markers, propagation checks, rollback
     boundaries and cost/approval gates.
5. **Design the guarded EAS environment and native-build lifecycle**
   - Define runtime-secret binding, target platforms, signing ownership, build receipts, store
     memberships and explicit cost approval. Do not start builds until these inputs exist.

## Milestone 2 — Remote validation matrix

6. **Validate an invite-only internal-tool profile**
   - Generate, provision, migrate, deploy and smoke a representative internal application.
7. **Validate a durable-jobs profile**
   - Define the jobs provider boundary, exercise recovery/idempotence and prove a real remote job.
8. **Validate an EU-private-documents profile**
   - Exercise R2 storage, access controls, retention boundaries and an end-to-end document flow.
9. **Validate the voice/realtime control plane**
   - Define the provider and secret boundaries, then run an isolated realtime canary.
10. **Complete cross-provider smoke coverage**
    - Run the full remote fixture matrix once the corresponding adapters exist and record exact,
      secret-free evidence.

Relationships grounded in the roadmap: issue 8 follows issue 1; issue 10 follows issues 1–4.

## Milestone 3 — Factory orchestration

11. **Connect Forge as the manifest producer**
    - Translate approved product intent into schema-v1 manifests, validate unsupported intent and
      preserve the deterministic Factory boundary.
12. **Implement Linear project bootstrap**
    - Create the project/backlog boundary from approved Factory/Forge intent, with preview-before-
      write, idempotence, ownership markers and no invented assignments or deadlines.

## Milestone 4 — Productization and governance

13. **Define exact provider rollback guarantees**
    - Classify reversible, compensating and manual-recovery actions for every live adapter.
14. **Finalize the remaining secret-binding model**
    - Cover EAS build environments and GitHub Actions while keeping credentials out of manifests,
      generated source and receipts.
15. **Define the Expo/React version-alignment policy**
    - Document supported version ranges, upgrade gates, fixture coverage and the SDK transition
      procedure.
16. **Choose and implement CLI packaging and distribution**
    - Decide the package name, release channel, installation path, versioning and upgrade contract.
17. **Define the post-generation transformation boundary**
    - Specify which future overlays may be receipt-owned after generation and which changes require
      a new manifest/schema or regeneration.

Do not add dependencies among issues 11–17 unless implementation evidence establishes them.
