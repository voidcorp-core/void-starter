# @void/db-self-hosted-postgres

> **Status: PLACEHOLDER** -- no implementation shipped yet. This is a wire scaffold documenting scope, env vars, and integration points. Activate only when leaving the default Neon-via-Vercel path is the right call (see ADR 11 in `docs/DECISIONS.md`).

Opt-in scaffold for self-hosted Postgres on a VPS or owned infrastructure. The starter ships Neon Postgres (Vercel Marketplace free tier) as the default for both dev and prod per ADR 11. This module is the rare migration path away from Neon when one of the activation conditions below is hit.

## Why this module

ADR 11 picked Neon by default because the Vercel + Neon Marketplace integration covers the venture builder profile (~24 MVPs/year, ~8 active) on the free tier with zero ops overhead and per-PR preview branches. Self-hosting Postgres reintroduces backups, monitoring, replication, security patches, capacity planning, and TLS rotation -- all costs that are not justified for typical 4-week B2C MVPs. This module exists for the cases where ADR 11's "when to revisit" trigger fires.

### When to activate

- **Data sovereignty hard requirement.** A regulated industry (healthcare, public sector, defense) or a contractual clause forces user data onto a specific country, hardware vendor, or self-managed infrastructure.
- **Cost optimization at scale.** The Neon bill exceeds ~$500/month on a single project and the workload is steady enough that a reserved VPS would be cheaper. (Below that threshold, ops time costs more than the bill saved.)
- **Exotic Postgres extensions.** The project needs an extension Neon does not support (`pg_partman`, `timescaledb`, custom-built extensions). Check Neon's supported extensions list first; their catalog is broad.
- **Contractual refusal of US-based vendors.** A B2B contract explicitly forbids Neon (Databricks-owned, US-headquartered) and an EU-only or self-hosted alternative is mandated.

If none of the above applies, stay on Neon. Migrating off Neon prematurely is a multi-day operation with no payoff.

## Required env vars

| Variable | Type | Description |
| --- | --- | --- |
| `DATABASE_URL` | secret | Postgres connection string for the self-hosted instance. Replaces the Neon URL after migration. Same name and shape as the Neon default. |
| `POSTGRES_PASSWORD` | secret | Used by the docker-compose template to seed the `void` superuser password. Not consumed by the app at runtime; only relevant during `docker compose up`. |

The application code does not change shape. Only the value behind `DATABASE_URL` flips.

## Migration steps

A migration from Neon to self-hosted is irreversible-ish (you can flip back if you keep the Neon project alive, but data divergence after the cutover is on you). Plan for a maintenance window.

1. **Provision the self-hosted Postgres.** The docker-compose template at `templates/docker-compose.yml.template` is a starting point for dev, single-node staging, or a quick proof-of-concept. Production-grade setups need:
   - Backups: `pg_basebackup` snapshots or continuous archiving via `wal-g` to S3-compatible storage
   - Monitoring: `pg_exporter` + Prometheus + Grafana, or a managed Postgres metrics provider
   - Replication: streaming replication for HA, or logical replication for zero-downtime migrations
   - TLS termination: either inside Postgres (`ssl=on` with managed certs) or behind a reverse proxy
   - OS hardening: firewall (only allow connections from the app's IP allowlist or VPN), fail2ban, automated security updates
   None of this is in scope for the template -- it deliberately stops at "Postgres is reachable on port 5432".

2. **Dump from Neon.** Use a recent `pg_dump` matching the Neon Postgres major version (16 at the time of writing):

   ```bash
   pg_dump --no-owner --no-acl --format=custom \
     "$NEON_DATABASE_URL" > void_backup.dump
   ```

   `--format=custom` is the parallel-restore-friendly format. `--no-owner` and `--no-acl` strip Neon-specific role grants.

3. **Restore into the self-hosted instance.**

   ```bash
   pg_restore --no-owner --no-acl --jobs=4 \
     --dbname="$SELF_HOSTED_DATABASE_URL" void_backup.dump
   ```

4. **Run Drizzle migrations on top.** The dump preserves the schema as-is, but pending migrations in `packages/db/src/migrations/` may be ahead. Run `bun run --cwd packages/db db:migrate` against the new URL to align.

5. **Update `DATABASE_URL` in Vercel and locally.** Replace the Neon-provisioned URL with the self-hosted one in Project Settings > Environment Variables. Update local `.env` files. Ensure the Vercel Functions can reach the self-hosted host (allowlist Vercel's egress IPs, or front the database with a tunnel like Tailscale).

6. **Test thoroughly before flipping prod traffic.** Run the full smoke test suite (`bun run test`, `bun run build`, manual E2E on a preview deployment) against the new database. Validate that connection pooling works without Neon's server-side pooler -- you may need to add PgBouncer in front of the self-hosted Postgres.

7. **Decommission Neon when confident.** Keep the Neon project alive for at least 7 days post-cutover so a rollback is possible. Then delete the Vercel Marketplace integration and the Neon project.

## Templates

- `_modules/db-self-hosted-postgres/templates/docker-compose.yml.template` -- minimal Postgres 16 service with a healthcheck and a named volume. NOT production-grade. Read the comments in the file before deploying.

The template uses `${POSTGRES_PASSWORD:?required}` so `docker compose up` fails loudly if the env var is unset rather than starting Postgres with a default password.

## Integration points

- `packages/db/src/client.ts` -- already reads `DATABASE_URL`, no code change needed (per ADR 12, `getDb()` is lazy + memoized + provider-agnostic)
- `packages/db/drizzle.config.ts` -- already reads `DATABASE_URL`, no code change needed (per ADR 13, `required('DATABASE_URL')` getter)
- Vercel Functions networking -- the self-hosted host must be reachable from the Vercel egress region, with TLS enforced
- Optional: PgBouncer or Pgpool-II in front of the self-hosted Postgres if connection counts spike

## Upstream docs

- https://www.postgresql.org/docs/16/ -- canonical Postgres 16 docs
- https://www.postgresql.org/docs/16/backup.html -- backup strategies
- https://github.com/wal-g/wal-g -- continuous archiving to S3
- https://www.pgbouncer.org -- connection pooler if Vercel Functions saturate the connection slots
- https://www.postgresql.org/docs/16/runtime-config-replication.html -- streaming replication for HA

## Rollback (after activating)

If the migration goes badly within the 7-day overlap window:

1. Repoint `DATABASE_URL` back to the Neon URL in Vercel and locally.
2. If any writes hit the self-hosted instance after cutover, replay them into Neon via a fresh `pg_dump`/`pg_restore` of the divergent rows. There is no automated tool for this; treat it as a manual reconciliation.
3. Delete the self-hosted infrastructure once confident.

After the 7-day window closes and the Neon project is deleted, rollback requires re-provisioning Neon from scratch and dumping from self-hosted -- the inverse of the migration.
