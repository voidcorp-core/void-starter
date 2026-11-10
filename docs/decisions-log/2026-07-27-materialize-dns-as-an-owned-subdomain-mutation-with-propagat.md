---
date: 2026-07-27
title: "Materialize DNS as an owned subdomain mutation with propagation-gated success"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-27: Materialize DNS as an owned subdomain mutation with propagation-gated success

- **Date:** 2026-07-27
- **Decision:** Resolve manifest `auto-detect` DNS intent only when the strict non-secret
  provisioning context supplies one exact Cloudflare account, zone ID/name and strict subdomain.
  Add `vercel.project-domain` before `cloudflare.dns-record`. Attach the hostname to the exact
  Vercel project, read Vercel's current rank-1 recommended CNAME, and create a DNS-only Cloudflare
  CNAME with TTL 60 and the action idempotency key in the record comment. Materialize any Vercel
  TXT ownership challenge with its own derived comment. Succeed only after Cloudflare readback,
  Vercel project-domain verification and `misconfigured=false`. Treat propagation as retryable,
  suppress repeated ambiguous creates, reject unmarked/drifted records, fix nameserver changes to
  false and estimated monthly cost to zero, and stop on a known paid-upgrade response. Do not
  automate rollback; document the safe manual order as owned DNS records first and Vercel
  project-domain attachment second.
- **Why:** Cloudflare exposes explicit record comments on every plan through its
  [DNS record API](https://developers.cloudflare.com/api/resources/dns/subresources/records/), so
  ownership can be proven without a companion secret or paid tag feature. Its
  [zone API](https://developers.cloudflare.com/api/resources/zones/methods/list/) makes account,
  zone name and active authoritative status observable during read-only preflight. Vercel now
  returns project-specific recommended CNAME values through domain configuration; using that
  value avoids freezing the legacy shared target. Vercel's
  [custom-domain guidance](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
  supports subdomains through CNAME, while a propagation-gated receipt prevents an accepted API
  mutation from being confused with a working public domain.
- **Rejected alternatives:**
  - Hard-code `cname.vercel-dns.com`: Vercel supplies ranked project-specific targets and can
    change the preferred value independently of Factory releases.
  - Support zone apex in this tranche: apex records require A/flattening choices and introduce a
    wider cutover/rollback blast radius than an isolated project subdomain.
  - Enable the Cloudflare proxy: double-CDN/TLS semantics are outside the selected Vercel origin
    contract; the first adapter is deliberately DNS-only.
  - Adopt an identical unmarked record: content equality does not establish ownership and would
    let Factory mutate or later remove another operator's record.
  - Change nameservers automatically: registrar delegation affects the whole zone and requires a
    separate explicit approval and rollback plan.
  - Delete the project domain or DNS record after a later failure: rollback can destroy a
    previously adopted public route; recovery is safer through reconciliation and an explicit
    operator decision.
- **Acceptance evidence:** Provider-mocked contracts cover exact-zone read-only preflight,
  deterministic domain/CNAME creation, TXT verification, comment ownership, stateless adoption,
  propagation-only resume, foreign-record rejection, ambiguous Vercel/Cloudflare mutation
  suppression, paid-upgrade refusal and absence of nameserver calls. The live isolated-zone
  canary remains the final acceptance gate.
- **When to revisit:** Add apex, Cloudflare proxy, Gandi LiveDNS or Vercel DNS only with equivalent
  ownership evidence, propagation checks and rollback boundaries. Revisit automatic rollback when
  provider APIs expose transactional or compare-and-delete guarantees tied to the exact ownership
  marker.
