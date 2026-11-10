---
date: 2026-07-29
title: "Upload documents straight to the bucket, then verify what landed"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-29: Upload documents straight to the bucket, then verify what landed

- **Date:** 2026-07-29
- **Decision:** Under `data.files: cloudflare-r2-eu`, the browser PUTs the bytes directly to R2
  against a presigned URL the server issues after an authorization check. The server never handles
  the file. The content type is baked into the signature, the row is written before the URL is
  handed out and stays `pending`, and a confirmation step HEADs the object and compares its real
  size and content type to what was claimed before anything is listed or downloadable. Download
  URLs are minted per click and live for a minute. Reaching the bucket from a browser also requires
  a CORS rule, provisioned as its own action and naming the allowed origins explicitly.
- **Why:** A proxied upload through a Server Action is capped by the Vercel request body limit of
  4.5 MB, which makes the profile useless for the documents it exists to hold, and bills compute for
  every byte. Uploading directly costs the server its sight of the file, so each thing the server
  would have checked while receiving it is replaced by something enforceable: the type by the
  signature, which R2 itself rejects on mismatch, and the size by the post-upload HEAD. `pending` is
  what makes the gap safe -- an authorized upload that never happened, or happened wrong, grants
  nothing.
- **Rejected alternatives:**
  - Proxying uploads through the application: full control over the bytes, at the cost of a 4.5 MB
    ceiling and compute per megabyte. Defensible for avatars, not for documents.
  - Trusting the declared size without the HEAD: the signature constrains the content type but
    nothing constrains the length, so an over-sized object is possible and would be published on
    the strength of a number the client chose.
  - Leaving a mismatched upload `pending` instead of erasing it: it keeps an object nobody vouched
    for in a bucket that is paid for, and a `pending` row that never resolves is indistinguishable
    from an abandoned one.
  - Rendering download URLs into the listing: each is a bearer token for one object, so the page
    would hand out a working link to every document on it, to wherever that page is later cached.
  - Allowing `https://*.vercel.app` in the CORS rule rather than naming origins: it opens a bucket
    of personal documents to every site hosted on Vercel. Preview deployments therefore cannot
    upload, which is the deliberate cost of the safe default.
- **Acceptance evidence:** Unit tests cover the rules against a substituted port; the integration
  suite covers them against the real ledger, including owner scoping in SQL and the unique object
  key; the E2E spec drives a browser through authorize/PUT/confirm against a real bucket, which is
  also the only place the CORS rule is exercised. The provisioning adapter reads the CORS policy
  back and fails retryably when the bucket does not report the requested origins.
- **When to revisit:** When a document must be readable by someone other than its owner, the
  access check moves from "owner scope" to a sharing model and the download URL stops being a
  per-click mint. Multipart upload for files beyond a few hundred MB is a separate mechanism and
  would change the confirmation step.
