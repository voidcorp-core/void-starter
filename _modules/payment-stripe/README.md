# @void/payment-stripe

> **Status: PLACEHOLDER** -- no implementation shipped yet. This is a wire scaffold documenting scope, env vars, and integration points. Implement when a real MVP needs it.

Opt-in scaffold for Stripe checkout, customer portal, and webhooks for B2C MVPs. The module is intentionally README-only at this stage; copy the steps below into a real package or app integration when an MVP needs paid flows.

## Why this module

Most B2C MVPs eventually need paid plans, one-shot purchases, or subscription gating. Stripe is the de-facto 2026 payments substrate (Checkout sessions, Customer Portal, Connect, Tax, Billing). The starter ships zero payment surface so projects that never monetize pay no bundle, ops, or audit cost. Activate this module on the first MVP that takes money.

## Required env vars

| Variable | Type | Description |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | secret | Server-side API key. Used by the Stripe Node SDK to create Checkout sessions, refund charges, and call the Customer Portal. |
| `STRIPE_WEBHOOK_SECRET` | secret | Signing secret for the webhook endpoint. The route handler verifies every payload via `stripe.webhooks.constructEvent`. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | public | Browser-side publishable key. Build-time inlined for the redirect-to-Checkout flow when using Stripe Elements or `loadStripe`. |

Optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `STRIPE_PRICE_ID` | none | Default price for Checkout when only one plan exists. Override per call site if the MVP has multiple SKUs. |

## Install (when implementing)

The module mirrors pattern A (real workspace package) used by `@void/sentry` and `@void/posthog`. Pattern B (copy-paste alternative) applies if the MVP only needs a single Checkout call site.

1. Add the dependency to the consuming app's `package.json`:

   ```json
   "dependencies": {
     "stripe": "^17.0.0"
   }
   ```

2. Run `bun install` from the repo root.

3. Add the Server Action that creates a Checkout session in `apps/web/src/actions/checkout.actions.ts`. Use `defineAction` from `@void/auth/auth-action` so auth, schema validation, and error mapping stay consistent with the rest of the actions surface.

4. Add the webhook handler at `apps/web/src/app/api/webhooks/stripe/route.ts`. The handler reads the raw body via `request.text()`, validates the signature against `STRIPE_WEBHOOK_SECRET`, and dispatches to a service-layer consumer (`apps/web/src/use-cases/billing/handle-stripe-event.ts`).

5. Mirror Stripe customers locally so domain code can join on `users.id`. Add a `stripe_customers` Drizzle table in `@void/db` schema with columns `user_id` (FK to `users.id`), `stripe_customer_id` (unique text), and timestamps. Generate the migration with `bun run --cwd packages/db db:generate`.

6. Decide whether to keep the Stripe SDK inline in `apps/web/` or promote it to `packages/payments/` once a second app needs it. Per ADR 07 (no micro-packages), only promote when cross-app reuse is real.

## Integration points

- `apps/web/src/actions/checkout.actions.ts` -- Server Action wrapping `stripe.checkout.sessions.create`
- `apps/web/src/app/api/webhooks/stripe/route.ts` -- raw-body webhook handler with signature verification
- `apps/web/src/app/api/billing/portal/route.ts` -- Customer Portal session redirect
- `@void/db` schema addition: `stripe_customers` table linking `users.id` to `stripe_customer_id`
- `apps/web/src/use-cases/billing/handle-stripe-event.ts` -- typed webhook event consumer per ADR 08 (events pattern)
- `packages/payments/` -- only if the SDK is consumed by 2+ apps (per ADR 07)

## Upstream docs

- https://stripe.com/docs
- https://stripe.com/docs/api
- https://stripe.com/docs/webhooks/signatures
- https://stripe.com/docs/billing/subscriptions/build-subscriptions

## Removal (after implementing)

The inverse of install:

1. Drop the `stripe` dependency from the consuming app's `package.json`.
2. Delete `apps/web/src/actions/checkout.actions.ts`, `apps/web/src/app/api/webhooks/stripe/route.ts`, and the Customer Portal route.
3. Drop the `stripe_customers` Drizzle table and generate a down-migration.
4. Unset `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in Vercel.
5. Run `bun install` to drop the lockfile entries.
