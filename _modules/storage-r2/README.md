# @repo/storage-r2

Private document storage on Cloudflare R2, EU jurisdiction. Pattern A module,
selected by `data.files: cloudflare-r2-eu` in the build manifest (ADR 68, ADR 69).

## What it is

An `ObjectStorage` port, an R2 adapter behind it, a `documents` ledger, and the
rules between them. Application code depends on the port
(`docs/FACTORY.md` section 6); `storage.object-store.ts` is the only file that
knows the provider by name, so replacing R2 means writing another adapter and
nothing else.

The bytes never pass through the server. The browser PUTs directly to a
presigned URL, which is what makes the profile usable for real documents rather
than for the 4.5 MB a proxied upload allows.

## Activation

The factory wires this automatically. To activate it by hand in another app:

1. Add `"@repo/storage-r2": "workspace:*"` to the app's `package.json`.
2. Add `'@repo/storage-r2'` to `transpilePackages` in `next.config.ts`.
3. Set the environment variables below.
4. Put a CORS rule on the bucket naming the app's origins (see below). Without
   it a browser upload fails even though the presigned URL is valid.

```
CLOUDFLARE_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
# One of these two, unless the bucket is in the default jurisdiction:
R2_ENDPOINT=
R2_JURISDICTION=
```

The credentials must be an Object Read & Write token scoped to the exact bucket.
They are marked Sensitive in Vercel per `docs/SECURITY.md` section 4.

`R2_ENDPOINT` is what the factory binds, and it wins outright. Set it by hand
too if you have it. Otherwise set `R2_JURISDICTION` to the jurisdiction the
bucket was created with (`eu` for this profile), because the host is composed
from the account id and a bucket answers on its own jurisdiction's host only
(ADR 70). Getting this wrong surfaces as a CORS error that no CORS rule fixes.

## The CORS rule

R2 enforces CORS on browser requests, so a presigned URL alone is not enough:
without a matching rule the browser refuses before anything is sent, and the
failure is invisible server-side. The factory provisions the rule as its own
action when the provisioning context names `browser_origins`. By hand:

```json
[
  {
    "AllowedOrigins": ["https://your-app.example.com", "http://localhost:3000"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

Name the origins. A wildcard opens a bucket of personal documents to every site
the browser visits. `DELETE` is deliberately absent: erasure goes through the
server, which is what makes it auditable.

Presigned URLs only work against the S3 API hostname, never a custom domain --
[Cloudflare's docs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).
That hostname carries the bucket's jurisdiction:
`<ACCOUNT_ID>.eu.r2.cloudflarestorage.com` here, and
`<ACCOUNT_ID>.r2.cloudflarestorage.com` only for a bucket created without one.
A host that does not match the bucket refuses it, and refuses to describe its
CORS policy along with it, which is why the browser blames CORS (ADR 70).

## The upload flow

Three steps, because the server never sees the file:

1. `requestDocumentUpload` validates the request, writes a `pending` row, and
   signs a PUT URL with the content type baked into the signature.
2. The browser PUTs the bytes with exactly that content type. R2 answers 403 to
   anything else.
3. `confirmDocumentUpload` HEADs the object and compares its real size and
   content type to what was claimed. Only then does the document become visible.

A `pending` row grants nothing: it is not listed, not downloadable, and its
object key is already taken so it cannot be reused. An upload that does not
match is erased along with its row.

## Erasure

`deleteDocument` erases the object first, the row second (ADR 69). If the object
cannot be erased the row stays and the caller sees the failure, so the erasure is
retried rather than silently half-applied.

The `documents` row cascades with its owner. That cascade is **not** erasure: it
drops the rows and leaves every object in the bucket, unnamed and unreachable.
Deleting a user's documents means calling the service for each of them first.

## Testing

- `storage.helper.test.ts`, `storage.service.test.ts`: the rules, against a
  substituted port. No Postgres, no network.
- `storage.integration.test.ts`: the same rules against the real ledger, gated on
  `DATABASE_URL`. Substitutes only the object store, because CI has no bucket
  (ADR 66).
- `apps/web/tests/e2e/documents.spec.ts`: a browser against a real bucket, gated
  on the R2 variables. The only place the adapter and the CORS rule are actually
  exercised.
