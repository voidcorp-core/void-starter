import { extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { BuildManifest } from './factory.types';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import {
  type ProvisioningAction,
  type ProvisioningContext,
  type ProvisioningPlan,
  provisioningContextSchema,
  provisioningPlanSchema,
} from './provisioning.types';

function createIdempotencyKey(action: Omit<ProvisioningAction, 'idempotency_key'>): string {
  return `void-starter:v1:${sha256(serializeCanonicalJson(action))}`;
}

function withIdempotencyKey(
  action: Omit<ProvisioningAction, 'idempotency_key'>,
): ProvisioningAction {
  return {
    ...action,
    idempotency_key: createIdempotencyKey(action),
  } as ProvisioningAction;
}

export function parseProvisioningContext(input: unknown): ProvisioningContext {
  return provisioningContextSchema.parse(input);
}

export function parseProvisioningContextSource(
  source: string,
  fileName: string,
): ProvisioningContext {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.json') {
    return parseProvisioningContext(JSON.parse(source));
  }
  if (extension === '.yaml' || extension === '.yml') {
    return parseProvisioningContext(parseYaml(source));
  }
  throw new Error(`Unsupported provisioning context format: ${extension || 'missing extension'}`);
}

export function createProvisioningPlan(
  manifest: BuildManifest,
  context: ProvisioningContext,
): ProvisioningPlan {
  const hasWeb = manifest.surfaces.web === 'next-vercel';
  const hasDatabase = manifest.data.database === 'neon-eu';
  const hasR2 = manifest.data.files === 'cloudflare-r2-eu';
  const hasSentry = hasWeb && manifest.operations.errors === 'sentry';
  const hasPosthog = hasWeb && manifest.operations.analytics === 'posthog';
  const selectedDnsProvider =
    manifest.dns.provider === 'auto-detect' ? context.dns?.provider : manifest.dns.provider;
  const hasDns = selectedDnsProvider !== undefined && selectedDnsProvider !== 'none';

  if (hasWeb && !context.vercel) {
    throw new Error('Provisioning context requires Vercel settings for the selected web surface');
  }
  if (hasDatabase && !context.neon) {
    throw new Error('Provisioning context requires Neon settings for the selected database');
  }
  if (hasR2 && !context.cloudflare) {
    throw new Error(
      'Provisioning context requires Cloudflare settings for the selected R2 storage',
    );
  }
  if (hasSentry && !context.sentry) {
    throw new Error('Provisioning context requires Sentry settings for the selected error adapter');
  }
  if (hasPosthog && !context.posthog) {
    throw new Error(
      'Provisioning context requires PostHog settings for the selected analytics adapter',
    );
  }
  if (hasDns && !hasWeb) {
    throw new Error('The current DNS adapter requires the selected Vercel web surface');
  }
  if (hasDns && selectedDnsProvider !== 'cloudflare') {
    throw new Error(`Live DNS provisioning does not support ${selectedDnsProvider}`);
  }
  if (hasDns && !context.dns) {
    throw new Error('Provisioning context requires DNS zone settings for the selected DNS adapter');
  }
  if (
    hasDns &&
    context.dns &&
    manifest.dns.provider !== 'auto-detect' &&
    manifest.dns.provider !== context.dns.provider
  ) {
    throw new Error('Provisioning context DNS provider does not match the manifest');
  }

  const actions: ProvisioningAction[] = [
    withIdempotencyKey({
      id: 'github.repository',
      provider: 'github',
      kind: 'ensure-repository',
      depends_on: [],
      permissions:
        context.github.owner_kind === 'organization'
          ? ['organization:members:read', 'repository:administration:write']
          : ['repository:administration:write'],
      input: {
        owner: context.github.owner,
        owner_kind: context.github.owner_kind,
        name: manifest.project.name,
        visibility: context.github.visibility,
      },
    }),
  ];

  if (hasWeb && context.vercel) {
    actions.push(
      withIdempotencyKey({
        id: 'vercel.project',
        provider: 'vercel',
        kind: 'ensure-project',
        depends_on: ['github.repository'],
        permissions: ['project:write'],
        input: {
          team_id: context.vercel.team_id,
          name: manifest.project.name,
          framework: 'nextjs',
          region: context.vercel.region,
          root_directory: 'apps/web',
          repository_action_id: 'github.repository',
        },
      }),
    );
  }

  if (hasDatabase && context.neon) {
    actions.push(
      withIdempotencyKey({
        id: 'neon.project',
        provider: 'neon',
        kind: 'ensure-project',
        depends_on: ['github.repository'],
        permissions: ['project:create'],
        input: {
          org_id: context.neon.org_id,
          name: manifest.project.name,
          region_id: context.neon.region_id,
        },
      }),
    );
  }

  if (hasWeb && hasDatabase) {
    actions.push(
      withIdempotencyKey({
        id: 'vercel.database-binding',
        provider: 'vercel',
        kind: 'ensure-database-binding',
        depends_on: ['vercel.project', 'neon.project'],
        permissions: ['project-environment:write'],
        input: {
          project_action_id: 'vercel.project',
          database_action_id: 'neon.project',
          environment_variable: 'DATABASE_URL',
          targets: ['development', 'preview', 'production'],
        },
      }),
    );
  }

  if (hasR2 && context.cloudflare) {
    actions.push(
      withIdempotencyKey({
        id: 'cloudflare.r2-bucket',
        provider: 'cloudflare',
        kind: 'ensure-r2-bucket',
        depends_on: [],
        permissions: ['r2-bucket:read', 'r2-bucket:write', 'r2-object:read', 'r2-object:write'],
        input: {
          account_id: context.cloudflare.account_id,
          name: manifest.project.name,
          jurisdiction: 'eu',
          storage_class: 'Standard',
        },
      }),
    );
  }

  if (hasWeb && hasR2) {
    actions.push(
      withIdempotencyKey({
        id: 'vercel.r2-binding',
        provider: 'vercel',
        kind: 'ensure-r2-binding',
        depends_on: ['vercel.project', 'cloudflare.r2-bucket'],
        permissions: ['project-environment:write'],
        input: {
          project_action_id: 'vercel.project',
          bucket_action_id: 'cloudflare.r2-bucket',
          bindings: [
            'CLOUDFLARE_ACCOUNT_ID',
            'R2_ACCESS_KEY_ID',
            'R2_BUCKET_NAME',
            'R2_ENDPOINT',
            'R2_SECRET_ACCESS_KEY',
          ],
          targets: ['development', 'preview', 'production'],
        },
      }),
    );
  }

  if (hasSentry && context.sentry) {
    actions.push(
      withIdempotencyKey({
        id: 'sentry.project',
        provider: 'sentry',
        kind: 'ensure-project',
        depends_on: [],
        permissions: ['organization:read', 'team:read', 'project:read', 'project:write'],
        input: {
          organization_slug: context.sentry.organization_slug,
          team_slug: context.sentry.team_slug,
          name: manifest.project.name,
          slug: manifest.project.name,
          region: context.sentry.region,
          platform: 'javascript-nextjs',
          default_rules: true,
        },
      }),
      withIdempotencyKey({
        id: 'vercel.sentry-binding',
        provider: 'vercel',
        kind: 'ensure-sentry-binding',
        depends_on: ['vercel.project', 'sentry.project'],
        permissions: ['project-environment:write'],
        input: {
          project_action_id: 'vercel.project',
          sentry_action_id: 'sentry.project',
          bindings: [
            'SENTRY_DSN',
            'NEXT_PUBLIC_SENTRY_DSN',
            'SENTRY_AUTH_TOKEN',
            'SENTRY_ORG',
            'SENTRY_PROJECT',
          ],
          targets: ['development', 'preview', 'production'],
        },
      }),
    );
  }

  if (hasPosthog && context.posthog) {
    actions.push(
      withIdempotencyKey({
        id: 'posthog.project',
        provider: 'posthog',
        kind: 'ensure-project',
        depends_on: [],
        permissions: ['organization:read', 'project:read', 'project:write'],
        input: {
          organization_id: context.posthog.organization_id,
          name: manifest.project.name,
          region: context.posthog.region,
        },
      }),
      withIdempotencyKey({
        id: 'vercel.posthog-binding',
        provider: 'vercel',
        kind: 'ensure-posthog-binding',
        depends_on: ['vercel.project', 'posthog.project'],
        permissions: ['project-environment:write'],
        input: {
          project_action_id: 'vercel.project',
          posthog_action_id: 'posthog.project',
          bindings: ['NEXT_PUBLIC_POSTHOG_KEY', 'NEXT_PUBLIC_POSTHOG_HOST'],
          targets: ['development', 'preview', 'production'],
        },
      }),
    );
  }

  if (hasDns && context.dns) {
    actions.push(
      withIdempotencyKey({
        id: 'vercel.project-domain',
        provider: 'vercel',
        kind: 'ensure-project-domain',
        depends_on: ['vercel.project'],
        permissions: ['project-domain:read', 'project-domain:write'],
        input: {
          project_action_id: 'vercel.project',
          name: context.dns.hostname,
          zone_name: context.dns.zone_name,
          dns_provider: 'cloudflare',
          nameserver_change: false,
          estimated_monthly_cost_eur: 0,
        },
      }),
      withIdempotencyKey({
        id: 'cloudflare.dns-record',
        provider: 'cloudflare',
        kind: 'ensure-dns-record',
        depends_on: ['vercel.project-domain'],
        permissions: ['zone:read', 'dns-record:read', 'dns-record:write'],
        input: {
          account_id: context.dns.account_id,
          zone_id: context.dns.zone_id,
          zone_name: context.dns.zone_name,
          hostname: context.dns.hostname,
          record_type: 'CNAME',
          ttl: 60,
          proxied: false,
          project_domain_action_id: 'vercel.project-domain',
          ownership_marker: 'comment',
          nameserver_change: false,
          estimated_monthly_cost_eur: 0,
        },
      }),
    );
  }

  return provisioningPlanSchema.parse({
    schema_version: 1,
    manifest_sha256: sha256(serializeCanonicalJson(manifest)),
    context_sha256: sha256(serializeCanonicalJson(context)),
    cost_policy: manifest.cost_policy,
    actions,
  });
}

export function provisioningPlanDigest(plan: ProvisioningPlan): string {
  return sha256(serializeCanonicalJson(plan));
}
