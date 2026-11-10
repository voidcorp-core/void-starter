---
date: 2026-07-26
title: "Bind delivery evidence to the exact source and keep protection bypass in memory"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-26: Bind delivery evidence to the exact source and keep protection bypass in memory

- **Date:** 2026-07-26
- **Decision:** Observe Vercel delivery through a separate `delivery:plan|preflight|live|resume`
  lifecycle. Bind its plan to the successful source-publication commit and source digest plus the
  provisioned Vercel team/project IDs and Production target. Poll only a deployment carrying that
  exact Git commit, require `READY`, then smoke the immutable deployment URL with manual redirects,
  HTTP 200, HTML content and project-identity checks. When Deployment Protection is active, send
  `VERCEL_AUTOMATION_BYPASS_SECRET` only through the `x-vercel-protection-bypass` request header.
  Persist non-secret deployment and smoke evidence in `.void-starter/delivery-state.json`.
- **Why:** A successful CI job or generic latest deployment does not prove that the published
  source snapshot is the application being exercised. Vercel SSO also makes an anonymous 302 a
  protection result rather than an application health result. Exact commit binding closes the
  provenance gap, while a memory-only bypass permits real HTTP validation without turning an
  access credential into source or receipt data. This follows Vercel's
  [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
  and [REST API](https://vercel.com/docs/rest-api) contracts.
- **Rejected alternatives:**
  - Accept the newest successful project deployment: can attest the wrong source revision.
  - Treat the SSO redirect as a passing smoke: proves protection configuration, not application
    availability.
  - Put the bypass in the URL, manifest, context or receipt: expands its exposure into logs,
    history and durable artifacts.
  - Disable Deployment Protection for the canary: weakens the sandbox instead of testing the
    intended production boundary.
- **When to revisit:** Prefer Vercel Trusted Sources/OIDC when the Factory runs inside an eligible
  workload with short-lived identity. Extend the receipt with migrations, authenticated health
  checks and canonical-domain evidence when those lifecycle stages exist.
