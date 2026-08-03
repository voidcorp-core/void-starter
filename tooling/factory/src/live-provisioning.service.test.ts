import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalManifest, mobileOnlyManifest } from './__fixtures__/manifest.fixture';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson } from './integrity.service';
import {
  LiveProvisioningAdapter,
  loadLiveProvisioningCredentials,
} from './live-provisioning.service';
import {
  applyProvisioning,
  ProvisioningApplyError,
  readProvisioningState,
} from './provisioning-apply.service';
import { createProvisioningPlan, parseProvisioningContext } from './provisioning-plan.service';

const temporaryRoots: string[] = [];
const connectionUri =
  'postgresql://neondb_owner:provider-secret@ep-example-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';
const sentryDsn = 'https://public-key@o123.ingest.de.sentry.io/456';
const posthogProjectKey = 'phc_posthog-project-public-key';
const posthogOrganizationId = '019d9316-714e-0000-01c7-e9a08d38242b';
const cloudflareZoneId = 'fedcba9876543210fedcba9876543210';
const projectHostname = 'example-saas.example.com';
const vercelDnsTarget = 'example.vercel-dns-017.com';

type RecordedRequest = {
  method: string;
  url: URL;
  authorization: string | null;
  r2Jurisdiction: string | null;
  body: unknown;
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

class MockProviderApi {
  repositoryExists = false;
  vercelProjectExists = false;
  neonProjectExists = false;
  bindingMarker: string | null = null;
  r2BucketExists = false;
  corsRules: unknown[] = [];
  corsAppliesNothing = false;
  /** Reproduces a runtime pair issued for a different bucket. */
  r2CredentialsWrongScope = false;
  r2BindingMarker: string | null = null;
  r2CanaryPayload: string | null = null;
  r2PublicDomainEnabled = false;
  r2CustomPublicDomainEnabled = false;
  githubMembershipPermissionDenied = false;
  neonOrganizationAccessible = true;
  failNeonCreateWithNetwork = false;
  failR2CreateWithNetwork = false;
  sentryProjectExists = false;
  sentryBindingMarker: string | null = null;
  sentryRegionUrl = 'https://de.sentry.io';
  failSentryCreateWithNetwork = false;
  posthogProjectExists = false;
  posthogBindingMarker: string | null = null;
  posthogOrganizationAccessible = true;
  failPosthogCreateWithNetwork = false;
  failPosthogBindingWithNetwork = false;
  vercelDomainExists = false;
  vercelDomainVerified = true;
  dnsPropagationPending = false;
  failVercelDomainCreateWithNetwork = false;
  vercelDomainNeedsUpgrade = false;
  failDnsCreateWithNetwork = false;
  cloudflareZoneAccessible = true;
  readonly dnsRecords: Array<{
    id: string;
    type: 'CNAME' | 'TXT';
    name: string;
    content: string;
    ttl: number;
    proxied: boolean;
    comment: string | null;
  }> = [];
  readonly requests: RecordedRequest[] = [];

  readonly fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const contentType = headers.get('content-type');
    const body =
      typeof init?.body === 'string'
        ? contentType === 'application/json'
          ? JSON.parse(init.body)
          : init.body
        : null;
    this.requests.push({
      method,
      url,
      authorization: headers.get('authorization'),
      r2Jurisdiction: headers.get('cf-r2-jurisdiction'),
      body,
    });

    if (url.hostname === 'api.github.com' && url.pathname === '/user') {
      return jsonResponse({ login: 'factory-bot' });
    }
    if (
      url.hostname === 'api.github.com' &&
      url.pathname === '/user/memberships/orgs/voidcorp-core'
    ) {
      return this.githubMembershipPermissionDenied
        ? jsonResponse({}, 403)
        : jsonResponse({
            state: 'active',
            organization: {
              login: 'voidcorp-core',
            },
          });
    }
    if (url.hostname === 'api.github.com' && url.pathname === '/repos/voidcorp-core/example-saas') {
      return this.repositoryExists
        ? jsonResponse({
            node_id: 'R_example',
            full_name: 'voidcorp-core/example-saas',
            private: true,
          })
        : jsonResponse({}, 404);
    }
    if (
      url.hostname === 'api.github.com' &&
      url.pathname === '/orgs/voidcorp-core/repos' &&
      method === 'POST'
    ) {
      this.repositoryExists = true;
      return jsonResponse({}, 201);
    }

    if (url.hostname === 'api.vercel.com' && url.pathname === '/v2/teams/team_example') {
      return jsonResponse({ id: 'team_example', name: 'Example' });
    }
    if (url.hostname === 'api.vercel.com' && url.pathname === '/v9/projects/example-saas') {
      return this.vercelProjectExists
        ? jsonResponse({
            id: 'prj_example',
            name: 'example-saas',
            framework: 'nextjs',
            rootDirectory: 'apps/web',
          })
        : jsonResponse({}, 404);
    }
    if (
      url.hostname === 'api.vercel.com' &&
      url.pathname === '/v10/projects' &&
      method === 'POST'
    ) {
      this.vercelProjectExists = true;
      return jsonResponse({}, 201);
    }
    if (
      url.hostname === 'api.vercel.com' &&
      url.pathname === `/v9/projects/prj_example/domains/${projectHostname}` &&
      method === 'GET'
    ) {
      return this.vercelDomainExists
        ? jsonResponse({
            name: projectHostname,
            apexName: 'example.com',
            projectId: 'prj_example',
            verified: this.vercelDomainVerified,
            verification: this.vercelDomainVerified
              ? []
              : [
                  {
                    type: 'TXT',
                    domain: `_vercel.${projectHostname}`,
                    value: 'vc-domain-verify=example-saas.example.com,mock-token',
                  },
                ],
          })
        : jsonResponse({}, 404);
    }
    if (
      url.hostname === 'api.vercel.com' &&
      url.pathname === '/v10/projects/prj_example/domains' &&
      method === 'POST'
    ) {
      if (this.vercelDomainNeedsUpgrade) {
        return jsonResponse({ error: { code: 'custom_domain_needs_upgrade' } }, 403);
      }
      if (this.failVercelDomainCreateWithNetwork) {
        throw new Error('mocked ambiguous Vercel domain network failure');
      }
      this.vercelDomainExists = true;
      return jsonResponse({}, 200);
    }
    if (
      url.hostname === 'api.vercel.com' &&
      url.pathname === `/v6/domains/${projectHostname}/config` &&
      method === 'GET'
    ) {
      const routingRecord = this.dnsRecords.find(
        (record) =>
          record.type === 'CNAME' &&
          record.name === projectHostname &&
          record.content === vercelDnsTarget,
      );
      return jsonResponse({
        configuredBy: routingRecord ? 'CNAME' : null,
        recommendedCNAME: [
          { rank: 1, value: `${vercelDnsTarget}.` },
          { rank: 2, value: 'cname.vercel-dns.com.' },
        ],
        misconfigured: this.dnsPropagationPending || !routingRecord,
      });
    }
    if (
      url.hostname === 'api.vercel.com' &&
      url.pathname === `/v9/projects/prj_example/domains/${projectHostname}/verify` &&
      method === 'POST'
    ) {
      const verificationRecord = this.dnsRecords.find(
        (record) =>
          record.type === 'TXT' &&
          record.name === `_vercel.${projectHostname}` &&
          record.content === 'vc-domain-verify=example-saas.example.com,mock-token',
      );
      if (verificationRecord) {
        this.vercelDomainVerified = true;
      }
      return this.vercelDomainVerified ? jsonResponse({}, 200) : jsonResponse({}, 400);
    }
    if (url.hostname === 'api.vercel.com' && url.pathname === '/v9/projects/prj_example/env') {
      const envs = [
        ...(this.bindingMarker
          ? [
              {
                id: 'env_database_sensitive',
                key: 'DATABASE_URL',
                type: 'sensitive',
                target: ['preview', 'production'],
              },
              {
                id: 'env_database_development',
                key: 'DATABASE_URL',
                type: 'encrypted',
                target: ['development'],
              },
              {
                id: 'env_marker',
                key: 'VOID_STARTER_DATABASE_BINDING_ID',
                type: 'plain',
                value: this.bindingMarker,
                target: ['development', 'preview', 'production'],
              },
            ]
          : []),
        ...(this.r2BindingMarker
          ? [
              ...['CLOUDFLARE_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ENDPOINT'].map((key) => ({
                id: `env_${key.toLowerCase()}`,
                key,
                type: 'encrypted',
                target: ['development', 'preview', 'production'],
              })),
              ...['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].flatMap((key) => [
                {
                  id: `env_${key.toLowerCase()}_sensitive`,
                  key,
                  type: 'sensitive',
                  target: ['preview', 'production'],
                },
                {
                  id: `env_${key.toLowerCase()}_development`,
                  key,
                  type: 'encrypted',
                  target: ['development'],
                },
              ]),
              {
                id: 'env_r2_marker',
                key: 'VOID_STARTER_R2_BINDING_ID',
                type: 'plain',
                value: this.r2BindingMarker,
                target: ['development', 'preview', 'production'],
              },
            ]
          : []),
        ...(this.sentryBindingMarker
          ? [
              ...['SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_ORG', 'SENTRY_PROJECT'].map(
                (key) => ({
                  id: `env_${key.toLowerCase()}`,
                  key,
                  type: 'encrypted',
                  target: ['development', 'preview', 'production'],
                }),
              ),
              {
                id: 'env_sentry_auth_sensitive',
                key: 'SENTRY_AUTH_TOKEN',
                type: 'sensitive',
                target: ['preview', 'production'],
              },
              {
                id: 'env_sentry_auth_development',
                key: 'SENTRY_AUTH_TOKEN',
                type: 'encrypted',
                target: ['development'],
              },
              {
                id: 'env_sentry_marker',
                key: 'VOID_STARTER_SENTRY_BINDING_ID',
                type: 'plain',
                value: this.sentryBindingMarker,
                target: ['development', 'preview', 'production'],
              },
            ]
          : []),
        ...(this.posthogBindingMarker
          ? [
              ...['NEXT_PUBLIC_POSTHOG_KEY', 'NEXT_PUBLIC_POSTHOG_HOST'].map((key) => ({
                id: `env_${key.toLowerCase()}`,
                key,
                type: 'encrypted',
                target: ['development', 'preview', 'production'],
              })),
              {
                id: 'env_posthog_marker',
                key: 'VOID_STARTER_POSTHOG_BINDING_ID',
                type: 'plain',
                value: this.posthogBindingMarker,
                target: ['development', 'preview', 'production'],
              },
            ]
          : []),
      ];
      return jsonResponse({ envs });
    }
    if (
      url.hostname === 'api.vercel.com' &&
      url.pathname === '/v10/projects/prj_example/env' &&
      method === 'POST'
    ) {
      const variables = body as Array<{ key: string; value: string }>;
      if (
        this.failPosthogBindingWithNetwork &&
        variables.some((variable) => variable.key === 'VOID_STARTER_POSTHOG_BINDING_ID')
      ) {
        throw new Error('mocked ambiguous PostHog binding network failure');
      }
      this.bindingMarker =
        variables.find((variable) => variable.key === 'VOID_STARTER_DATABASE_BINDING_ID')?.value ??
        this.bindingMarker;
      this.r2BindingMarker =
        variables.find((variable) => variable.key === 'VOID_STARTER_R2_BINDING_ID')?.value ??
        this.r2BindingMarker;
      this.sentryBindingMarker =
        variables.find((variable) => variable.key === 'VOID_STARTER_SENTRY_BINDING_ID')?.value ??
        this.sentryBindingMarker;
      this.posthogBindingMarker =
        variables.find((variable) => variable.key === 'VOID_STARTER_POSTHOG_BINDING_ID')?.value ??
        this.posthogBindingMarker;
      return jsonResponse({}, 201);
    }

    if (url.hostname === 'console.neon.tech' && url.pathname === '/api/v2/users/me/organizations') {
      return jsonResponse({
        organizations: this.neonOrganizationAccessible ? [{ id: 'org-example' }] : [],
      });
    }
    if (
      url.hostname === 'console.neon.tech' &&
      url.pathname === '/api/v2/projects' &&
      method === 'GET'
    ) {
      return jsonResponse({
        projects: this.neonProjectExists
          ? [
              {
                id: 'neon-example',
                name: 'example-saas',
                region_id: 'aws-eu-central-1',
              },
            ]
          : [],
      });
    }
    if (
      url.hostname === 'console.neon.tech' &&
      url.pathname === '/api/v2/projects' &&
      method === 'POST'
    ) {
      if (this.failNeonCreateWithNetwork) {
        throw new Error('mocked ambiguous network failure');
      }
      this.neonProjectExists = true;
      return jsonResponse({}, 201);
    }
    if (
      url.hostname === 'console.neon.tech' &&
      url.pathname === '/api/v2/projects/neon-example/connection_uri'
    ) {
      return jsonResponse({ uri: connectionUri });
    }

    const dnsBase = `/client/v4/zones/${cloudflareZoneId}`;
    if (url.hostname === 'api.cloudflare.com' && url.pathname === dnsBase && method === 'GET') {
      return this.cloudflareZoneAccessible
        ? jsonResponse({
            success: true,
            result: {
              id: cloudflareZoneId,
              name: 'example.com',
              account: { id: '0123456789abcdef0123456789abcdef' },
              status: 'active',
              type: 'full',
              paused: false,
            },
          })
        : jsonResponse({}, 404);
    }
    if (
      url.hostname === 'api.cloudflare.com' &&
      url.pathname === `${dnsBase}/dns_records` &&
      method === 'GET'
    ) {
      const type = url.searchParams.get('type');
      const name = url.searchParams.get('name');
      return jsonResponse({
        success: true,
        result: this.dnsRecords
          .filter((record) => record.type === type && record.name === name)
          .map((record) => ({
            ...record,
            zone_id: cloudflareZoneId,
            zone_name: 'example.com',
          })),
      });
    }
    if (
      url.hostname === 'api.cloudflare.com' &&
      url.pathname === `${dnsBase}/dns_records` &&
      method === 'POST'
    ) {
      if (this.failDnsCreateWithNetwork) {
        throw new Error('mocked ambiguous DNS network failure');
      }
      const input = body as {
        type: 'CNAME' | 'TXT';
        name: string;
        content: string;
        ttl: number;
        proxied: boolean;
        comment: string;
      };
      const record = {
        id: `dns_${this.dnsRecords.length + 1}`,
        type: input.type,
        name: input.name,
        content: input.content.replace(/\.$/, ''),
        ttl: input.ttl,
        proxied: input.proxied,
        comment: input.comment,
      };
      this.dnsRecords.push(record);
      return jsonResponse({
        success: true,
        result: {
          ...record,
          zone_id: cloudflareZoneId,
          zone_name: 'example.com',
        },
      });
    }

    // The S3 endpoint, a different host from the Cloudflare API. Only the signed
    // HEAD that proves credential scope ever reaches it.
    if (url.hostname.endsWith('.r2.cloudflarestorage.com')) {
      if (method === 'HEAD') {
        const authorized = !this.r2CredentialsWrongScope && url.pathname === '/example-saas';
        return new Response(null, { status: authorized ? 200 : 403 });
      }
      return new Response(null, { status: 405 });
    }

    const r2Base = '/client/v4/accounts/0123456789abcdef0123456789abcdef/r2/buckets';
    const r2Bucket = `${r2Base}/example-saas`;
    if (url.hostname === 'api.cloudflare.com' && url.pathname === r2Base && method === 'GET') {
      return jsonResponse({
        success: true,
        result: {
          buckets: this.r2BucketExists
            ? [
                {
                  name: 'example-saas',
                  jurisdiction: 'eu',
                  storage_class: 'Standard',
                },
              ]
            : [],
        },
      });
    }
    if (url.hostname === 'api.cloudflare.com' && url.pathname === r2Bucket && method === 'GET') {
      return this.r2BucketExists
        ? jsonResponse({
            success: true,
            result: {
              name: 'example-saas',
              jurisdiction: 'eu',
              storage_class: 'Standard',
            },
          })
        : jsonResponse({}, 404);
    }
    if (url.hostname === 'api.cloudflare.com' && url.pathname === `${r2Bucket}/cors`) {
      if (method === 'PUT') {
        // `corsAppliesNothing` reproduces an accepted PUT that does not take:
        // the browser then refuses every upload, and nothing server-side sees it.
        if (!this.corsAppliesNothing) {
          this.corsRules = (body as { rules?: unknown[] } | undefined)?.rules ?? [];
        }
        return jsonResponse({ success: true, result: null });
      }
      if (method === 'GET') {
        return jsonResponse({ success: true, result: { rules: this.corsRules } });
      }
    }
    if (url.hostname === 'api.cloudflare.com' && url.pathname === r2Base && method === 'POST') {
      if (this.failR2CreateWithNetwork) {
        throw new Error('mocked ambiguous R2 network failure');
      }
      this.r2BucketExists = true;
      return jsonResponse({
        success: true,
        result: {
          name: 'example-saas',
          jurisdiction: 'eu',
          storage_class: 'Standard',
        },
      });
    }
    if (url.hostname === 'api.cloudflare.com' && url.pathname === `${r2Bucket}/domains/managed`) {
      return jsonResponse({
        success: true,
        result: {
          bucketId: 'r2_bucket_example',
          domain: 'pub-example.r2.dev',
          enabled: this.r2PublicDomainEnabled,
        },
      });
    }
    if (url.hostname === 'api.cloudflare.com' && url.pathname === `${r2Bucket}/domains/custom`) {
      return jsonResponse({
        success: true,
        result: {
          domains: this.r2CustomPublicDomainEnabled
            ? [{ domain: 'documents.example.com', enabled: true }]
            : [],
        },
      });
    }
    if (url.hostname === 'api.cloudflare.com' && url.pathname.startsWith(`${r2Bucket}/objects/`)) {
      const objectKey = decodeURIComponent(url.pathname.slice(`${r2Bucket}/objects/`.length));
      if (method === 'PUT') {
        if (contentType !== 'application/octet-stream') {
          throw new Error('Expected R2 canary octet-stream content type');
        }
        if (typeof body !== 'string') throw new Error('Expected raw R2 canary payload');
        this.r2CanaryPayload = body;
        return jsonResponse({
          success: true,
          result: { key: objectKey, etag: 'canary-etag' },
        });
      }
      if (method === 'GET') {
        return new Response(this.r2CanaryPayload, { status: 200 });
      }
      if (method === 'DELETE') {
        this.r2CanaryPayload = null;
        return jsonResponse({ success: true, result: { key: objectKey } });
      }
    }

    if (
      url.hostname === 'de.sentry.io' &&
      url.pathname === '/api/0/organizations/void-sandbox/' &&
      method === 'GET'
    ) {
      return jsonResponse({
        slug: 'void-sandbox',
        status: { id: 'active' },
        links: { regionUrl: this.sentryRegionUrl },
      });
    }
    if (
      url.hostname === 'de.sentry.io' &&
      url.pathname === '/api/0/teams/void-sandbox/platform/' &&
      method === 'GET'
    ) {
      return jsonResponse({
        slug: 'platform',
        hasAccess: true,
        organization: { slug: 'void-sandbox' },
      });
    }
    if (
      url.hostname === 'de.sentry.io' &&
      url.pathname === '/api/0/projects/void-sandbox/example-saas/' &&
      method === 'GET'
    ) {
      return this.sentryProjectExists
        ? jsonResponse({
            id: 'sentry_project_example',
            slug: 'example-saas',
            name: 'example-saas',
            platform: 'javascript-nextjs',
            status: 'active',
            teams: [{ slug: 'platform' }],
          })
        : jsonResponse({}, 404);
    }
    if (
      url.hostname === 'de.sentry.io' &&
      url.pathname === '/api/0/teams/void-sandbox/platform/projects/' &&
      method === 'POST'
    ) {
      if (this.failSentryCreateWithNetwork) {
        throw new Error('mocked ambiguous Sentry network failure');
      }
      this.sentryProjectExists = true;
      return jsonResponse({}, 201);
    }
    if (
      url.hostname === 'de.sentry.io' &&
      url.pathname === '/api/0/projects/void-sandbox/example-saas/keys/' &&
      method === 'GET'
    ) {
      return jsonResponse(
        this.sentryProjectExists
          ? [
              {
                id: 'sentry_key_example',
                projectId: 'sentry_project_example',
                isActive: true,
                dsn: { public: sentryDsn },
              },
            ]
          : [],
      );
    }

    const posthogProjects = `/api/organizations/${posthogOrganizationId}/projects/`;
    if (
      url.hostname === 'eu.posthog.com' &&
      url.pathname === `/api/organizations/${posthogOrganizationId}/` &&
      method === 'GET'
    ) {
      return this.posthogOrganizationAccessible
        ? jsonResponse({ id: posthogOrganizationId })
        : jsonResponse({}, 404);
    }
    if (url.hostname === 'eu.posthog.com' && url.pathname === posthogProjects && method === 'GET') {
      return jsonResponse({
        count: this.posthogProjectExists ? 1 : 0,
        results: this.posthogProjectExists
          ? [
              {
                id: 42,
                organization: posthogOrganizationId,
                name: 'example-saas',
                api_token: posthogProjectKey,
              },
            ]
          : [],
      });
    }
    if (
      url.hostname === 'eu.posthog.com' &&
      url.pathname === posthogProjects &&
      method === 'POST'
    ) {
      if (this.failPosthogCreateWithNetwork) {
        throw new Error('mocked ambiguous PostHog network failure');
      }
      this.posthogProjectExists = true;
      return jsonResponse({}, 201);
    }
    if (
      url.hostname === 'eu.posthog.com' &&
      url.pathname === `${posthogProjects}42/` &&
      method === 'GET'
    ) {
      return this.posthogProjectExists
        ? jsonResponse({
            id: 42,
            organization: posthogOrganizationId,
            name: 'example-saas',
            api_token: posthogProjectKey,
          })
        : jsonResponse({}, 404);
    }

    throw new Error(`Unexpected provider request: ${method} ${url.toString()}`);
  };
}

const context = parseProvisioningContext({
  schema_version: 1,
  github: {
    owner: 'voidcorp-core',
    owner_kind: 'organization',
    visibility: 'private',
  },
  vercel: {
    team_id: 'team_example',
    region: 'fra1',
  },
  neon: {
    org_id: 'org-example',
    region_id: 'aws-eu-central-1',
  },
  cloudflare: {
    account_id: '0123456789abcdef0123456789abcdef',
  },
  sentry: {
    organization_slug: 'void-sandbox',
    team_slug: 'platform',
    region: 'de',
  },
  posthog: {
    organization_id: posthogOrganizationId,
    region: 'eu',
  },
  dns: {
    provider: 'cloudflare',
    account_id: '0123456789abcdef0123456789abcdef',
    zone_id: cloudflareZoneId,
    zone_name: 'example.com',
    hostname: projectHostname,
  },
});

const credentials = {
  githubToken: 'github-provider-secret',
  vercelToken: 'vercel-provider-secret',
  neonApiKey: 'neon-provider-secret',
  cloudflareApiToken: 'cloudflare-provider-secret',
  r2AccessKeyId: 'r2-access-provider-secret',
  r2SecretAccessKey: 'r2-secret-provider-secret',
  sentryApiToken: 'sentry-control-provider-secret',
  sentryBuildAuthToken: 'sentry-build-provider-secret',
  posthogPersonalApiKey: 'posthog-control-provider-secret',
};

async function createGeneratedProject() {
  const root = await mkdtemp(join(tmpdir(), 'void-starter-live-apply-test-'));
  temporaryRoots.push(root);
  const manifest = parseBuildManifest(canonicalManifest);
  await mkdir(join(root, '.void-starter'));
  await writeFile(
    join(root, '.void-starter/manifest.json'),
    serializeCanonicalJson(manifest),
    'utf8',
  );
  return {
    root,
    plan: createProvisioningPlan(manifest, context),
  };
}

/** The same context, plus the browser origins that make the bucket reachable. */
const corsContext = parseProvisioningContext({
  ...JSON.parse(JSON.stringify(context)),
  cloudflare: {
    account_id: '0123456789abcdef0123456789abcdef',
    browser_origins: ['https://app.example.com', 'http://localhost:3000'],
  },
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('LiveProvisioningAdapter', () => {
  it('preflights identities, creates the first provider tranche, and never persists secrets', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();

    const state = await applyProvisioning({
      projectRoot: project.root,
      plan: project.plan,
      adapter: new LiveProvisioningAdapter({
        credentials,
        fetch: provider.fetch,
      }),
    });

    expect(state.mode).toBe('live');
    expect(state.status).toBe('succeeded');
    expect(state.actions.map((action) => action.resource?.resource_id)).toEqual([
      'R_example',
      'prj_example',
      'neon-example',
      'env_marker',
      'r2_bucket_example',
      'env_r2_marker',
      'sentry_project_example',
      'env_sentry_marker',
      '42',
      'env_posthog_marker',
      `prj_example:${projectHostname}`,
      'dns_1',
    ]);
    expect(provider.requests.filter((request) => request.method === 'POST')).toHaveLength(12);
    // The signed HEAD against the S3 endpoint is the one request that is not a
    // Bearer call, by construction: it authenticates with an AWS4 signature over
    // the runtime pair. It is held to a stricter rule below -- it must carry no
    // provider token at all.
    const bearerRequests = provider.requests.filter(
      (request) => !request.url.hostname.endsWith('.r2.cloudflarestorage.com'),
    );
    const s3Requests = provider.requests.filter((request) =>
      request.url.hostname.endsWith('.r2.cloudflarestorage.com'),
    );
    expect(s3Requests).toHaveLength(1);
    expect(s3Requests[0]?.authorization?.startsWith('AWS4-HMAC-SHA256 ')).toBe(true);
    // The access key id belongs in an AWS4 credential scope; it is an
    // identifier, not a secret. Everything else must be absent -- above all the
    // Cloudflare control token, which `#request` would otherwise attach and
    // which grants far more than this one bucket.
    for (const [name, token] of Object.entries(credentials)) {
      if (name === 'r2AccessKeyId') continue;
      expect(s3Requests[0]?.authorization).not.toContain(token);
    }
    expect(bearerRequests.every((request) => request.authorization?.startsWith('Bearer '))).toBe(
      true,
    );
    for (const request of bearerRequests) {
      const expectedAuthorization =
        request.url.hostname === 'api.github.com'
          ? `Bearer ${credentials.githubToken}`
          : request.url.hostname === 'api.vercel.com'
            ? `Bearer ${credentials.vercelToken}`
            : request.url.hostname === 'console.neon.tech'
              ? `Bearer ${credentials.neonApiKey}`
              : request.url.hostname === 'api.cloudflare.com'
                ? `Bearer ${credentials.cloudflareApiToken}`
                : request.url.hostname === 'de.sentry.io'
                  ? `Bearer ${credentials.sentryApiToken}`
                  : `Bearer ${credentials.posthogPersonalApiKey}`;
      expect(request.authorization).toBe(expectedAuthorization);
    }

    expect(
      provider.requests.find(
        (request) => request.method === 'POST' && request.url.pathname === '/v10/projects',
      )?.body,
    ).toEqual({
      name: 'example-saas',
      framework: 'nextjs',
      rootDirectory: 'apps/web',
      gitRepository: {
        type: 'github',
        repo: 'voidcorp-core/example-saas',
      },
    });
    const neonCreateRequest = provider.requests.find(
      (request) =>
        request.method === 'POST' &&
        request.url.hostname === 'console.neon.tech' &&
        request.url.pathname === '/api/v2/projects',
    );
    expect(neonCreateRequest?.url.searchParams.get('org_id')).toBe('org-example');
    expect(neonCreateRequest?.body).toEqual({
      project: {
        name: 'example-saas',
        region_id: 'aws-eu-central-1',
      },
    });

    const environmentRequest = provider.requests.find(
      (request) => request.url.pathname === '/v10/projects/prj_example/env',
    );
    expect(environmentRequest?.body).toEqual([
      {
        key: 'DATABASE_URL',
        type: 'sensitive',
        target: ['preview', 'production'],
        value: connectionUri,
      },
      {
        key: 'DATABASE_URL',
        type: 'encrypted',
        target: ['development'],
        value: connectionUri,
      },
      {
        key: 'VOID_STARTER_DATABASE_BINDING_ID',
        type: 'plain',
        target: ['development', 'preview', 'production'],
        value: expect.any(String),
      },
    ]);

    const r2CreateRequest = provider.requests.find(
      (request) =>
        request.method === 'POST' &&
        request.url.hostname === 'api.cloudflare.com' &&
        request.url.pathname.endsWith('/r2/buckets'),
    );
    expect(r2CreateRequest).toMatchObject({
      r2Jurisdiction: 'eu',
      body: { name: 'example-saas', storageClass: 'Standard' },
    });
    expect(provider.r2CanaryPayload).toBeNull();

    const sentryCreateRequest = provider.requests.find(
      (request) =>
        request.method === 'POST' &&
        request.url.hostname === 'de.sentry.io' &&
        request.url.pathname.endsWith('/platform/projects/'),
    );
    expect(sentryCreateRequest?.body).toEqual({
      name: 'example-saas',
      slug: 'example-saas',
      platform: 'javascript-nextjs',
      default_rules: true,
    });

    const posthogCreateRequest = provider.requests.find(
      (request) =>
        request.method === 'POST' &&
        request.url.hostname === 'eu.posthog.com' &&
        request.url.pathname === `/api/organizations/${posthogOrganizationId}/projects/`,
    );
    expect(posthogCreateRequest?.body).toEqual({ name: 'example-saas' });

    const projectDomainRequest = provider.requests.find(
      (request) =>
        request.method === 'POST' && request.url.pathname === '/v10/projects/prj_example/domains',
    );
    expect(projectDomainRequest?.body).toEqual({ name: projectHostname });

    const dnsRequest = provider.requests.find(
      (request) =>
        request.method === 'POST' &&
        request.url.pathname === `/client/v4/zones/${cloudflareZoneId}/dns_records`,
    );
    expect(dnsRequest?.body).toEqual({
      type: 'CNAME',
      name: projectHostname,
      content: vercelDnsTarget,
      ttl: 60,
      proxied: false,
      comment: expect.stringMatching(/^void-starter:v1:[a-f0-9]{64}$/),
    });

    const r2EnvironmentRequest = provider.requests.find(
      (request) =>
        request.method === 'POST' &&
        Array.isArray(request.body) &&
        request.body.some(
          (variable: { key?: string }) => variable.key === 'VOID_STARTER_R2_BINDING_ID',
        ),
    );
    expect(r2EnvironmentRequest?.body).toEqual(
      expect.arrayContaining([
        {
          key: 'R2_ACCESS_KEY_ID',
          type: 'sensitive',
          target: ['preview', 'production'],
          value: credentials.r2AccessKeyId,
        },
        {
          key: 'R2_SECRET_ACCESS_KEY',
          type: 'sensitive',
          target: ['preview', 'production'],
          value: credentials.r2SecretAccessKey,
        },
        {
          key: 'R2_ENDPOINT',
          type: 'encrypted',
          target: ['development', 'preview', 'production'],
          value: 'https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com',
        },
      ]),
    );

    const sentryEnvironmentRequest = provider.requests.find(
      (request) =>
        request.method === 'POST' &&
        Array.isArray(request.body) &&
        request.body.some(
          (variable: { key?: string }) => variable.key === 'VOID_STARTER_SENTRY_BINDING_ID',
        ),
    );
    expect(sentryEnvironmentRequest?.body).toEqual(
      expect.arrayContaining([
        {
          key: 'SENTRY_DSN',
          type: 'encrypted',
          target: ['development', 'preview', 'production'],
          value: sentryDsn,
        },
        {
          key: 'NEXT_PUBLIC_SENTRY_DSN',
          type: 'encrypted',
          target: ['development', 'preview', 'production'],
          value: sentryDsn,
        },
        {
          key: 'SENTRY_AUTH_TOKEN',
          type: 'sensitive',
          target: ['preview', 'production'],
          value: credentials.sentryBuildAuthToken,
        },
      ]),
    );

    const posthogEnvironmentRequest = provider.requests.find(
      (request) =>
        request.method === 'POST' &&
        Array.isArray(request.body) &&
        request.body.some(
          (variable: { key?: string }) => variable.key === 'VOID_STARTER_POSTHOG_BINDING_ID',
        ),
    );
    expect(posthogEnvironmentRequest?.body).toEqual([
      {
        key: 'NEXT_PUBLIC_POSTHOG_KEY',
        type: 'encrypted',
        target: ['development', 'preview', 'production'],
        value: posthogProjectKey,
      },
      {
        key: 'NEXT_PUBLIC_POSTHOG_HOST',
        type: 'encrypted',
        target: ['development', 'preview', 'production'],
        value: '/ingest',
      },
      {
        key: 'VOID_STARTER_POSTHOG_BINDING_ID',
        type: 'plain',
        target: ['development', 'preview', 'production'],
        value: expect.any(String),
      },
    ]);

    const persistedState = await readFile(
      join(project.root, '.void-starter/apply-state.json'),
      'utf8',
    );
    for (const secret of [...Object.values(credentials), 'provider-secret']) {
      expect(persistedState).not.toContain(secret);
    }
  });

  it('adopts matching resources and bindings without issuing create requests', async () => {
    const project = await createGeneratedProject();
    const bindingAction = project.plan.actions.find(
      (action) => action.id === 'vercel.database-binding',
    );
    if (!bindingAction) {
      throw new Error('Expected database binding action');
    }
    const provider = new MockProviderApi();
    provider.repositoryExists = true;
    provider.vercelProjectExists = true;
    provider.neonProjectExists = true;
    provider.bindingMarker = bindingAction.idempotency_key;
    provider.r2BucketExists = true;
    const r2BindingAction = project.plan.actions.find(
      (action) => action.id === 'vercel.r2-binding',
    );
    if (!r2BindingAction) throw new Error('Expected R2 binding action');
    provider.r2BindingMarker = r2BindingAction.idempotency_key;
    provider.sentryProjectExists = true;
    const sentryBindingAction = project.plan.actions.find(
      (action) => action.id === 'vercel.sentry-binding',
    );
    if (!sentryBindingAction) throw new Error('Expected Sentry binding action');
    provider.sentryBindingMarker = sentryBindingAction.idempotency_key;
    provider.posthogProjectExists = true;
    const posthogBindingAction = project.plan.actions.find(
      (action) => action.id === 'vercel.posthog-binding',
    );
    if (!posthogBindingAction) throw new Error('Expected PostHog binding action');
    provider.posthogBindingMarker = posthogBindingAction.idempotency_key;
    provider.vercelDomainExists = true;
    const dnsAction = project.plan.actions.find((action) => action.id === 'cloudflare.dns-record');
    if (!dnsAction) throw new Error('Expected DNS record action');
    provider.dnsRecords.push({
      id: 'dns_existing',
      type: 'CNAME',
      name: projectHostname,
      content: vercelDnsTarget,
      ttl: 60,
      proxied: false,
      comment: dnsAction.idempotency_key,
    });

    const state = await applyProvisioning({
      projectRoot: project.root,
      plan: project.plan,
      adapter: new LiveProvisioningAdapter({
        credentials,
        fetch: provider.fetch,
      }),
    });

    expect(state.status).toBe('succeeded');
    expect(provider.requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('publishes Vercel ownership verification and the routing CNAME with owned comments', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.vercelDomainVerified = false;

    const state = await applyProvisioning({
      projectRoot: project.root,
      plan: project.plan,
      adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
    });

    expect(state.status).toBe('succeeded');
    expect(provider.vercelDomainVerified).toBe(true);
    expect(provider.dnsRecords).toHaveLength(2);
    expect(provider.dnsRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'CNAME',
          name: projectHostname,
          content: vercelDnsTarget,
          ttl: 60,
          proxied: false,
          comment: expect.stringMatching(/^void-starter:v1:[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          type: 'TXT',
          name: `_vercel.${projectHostname}`,
          content: 'vc-domain-verify=example-saas.example.com,mock-token',
          comment: expect.stringMatching(/:verification:1$/),
        }),
      ]),
    );
    expect(
      state.actions.find((action) => action.action_id === 'cloudflare.dns-record')?.resource,
    ).toMatchObject({
      propagation: 'verified',
      project_domain_verified: true,
      verification_record_ids: ['dns_2'],
      nameserver_change: false,
      estimated_monthly_cost_eur: 0,
      rollback_boundary: 'manual-owned-record-then-project-domain',
    });
    expect(provider.requests.some((request) => request.url.pathname.includes('nameserver'))).toBe(
      false,
    );
  });

  it('resumes propagation without recreating the Vercel domain or Cloudflare record', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.dnsPropagationPending = true;

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      (await readProvisioningState(project.root))?.actions.find(
        (action) => action.action_id === 'cloudflare.dns-record',
      ),
    ).toMatchObject({
      attempts: 1,
      status: 'failed',
      error: { code: 'VERCEL_DNS_PROPAGATION_PENDING', retryable: true },
    });

    provider.dnsPropagationPending = false;
    const resumed = await applyProvisioning({
      projectRoot: project.root,
      plan: project.plan,
      adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      requireExistingState: true,
    });
    expect(resumed.status).toBe('succeeded');
    expect(
      resumed.actions.find((action) => action.action_id === 'cloudflare.dns-record'),
    ).toMatchObject({ attempts: 2, status: 'succeeded' });
    expect(
      provider.requests.filter(
        (request) =>
          request.method === 'POST' && request.url.pathname === '/v10/projects/prj_example/domains',
      ),
    ).toHaveLength(1);
    expect(
      provider.requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.url.pathname === `/client/v4/zones/${cloudflareZoneId}/dns_records`,
      ),
    ).toHaveLength(1);
  });

  it('never repeats ambiguous domain or DNS creates and rejects foreign DNS ownership', async () => {
    const domainProject = await createGeneratedProject();
    const domainProvider = new MockProviderApi();
    domainProvider.failVercelDomainCreateWithNetwork = true;
    await expect(
      applyProvisioning({
        projectRoot: domainProject.root,
        plan: domainProject.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: domainProvider.fetch }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    await expect(
      applyProvisioning({
        projectRoot: domainProject.root,
        plan: domainProject.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: domainProvider.fetch }),
        requireExistingState: true,
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      domainProvider.requests.filter(
        (request) =>
          request.method === 'POST' && request.url.pathname === '/v10/projects/prj_example/domains',
      ),
    ).toHaveLength(1);

    const dnsProject = await createGeneratedProject();
    const dnsProvider = new MockProviderApi();
    dnsProvider.failDnsCreateWithNetwork = true;
    await expect(
      applyProvisioning({
        projectRoot: dnsProject.root,
        plan: dnsProject.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: dnsProvider.fetch }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    await expect(
      applyProvisioning({
        projectRoot: dnsProject.root,
        plan: dnsProject.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: dnsProvider.fetch }),
        requireExistingState: true,
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      dnsProvider.requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.url.pathname === `/client/v4/zones/${cloudflareZoneId}/dns_records`,
      ),
    ).toHaveLength(1);

    const conflictProject = await createGeneratedProject();
    const conflictProvider = new MockProviderApi();
    conflictProvider.dnsRecords.push({
      id: 'dns_foreign',
      type: 'CNAME',
      name: projectHostname,
      content: vercelDnsTarget,
      ttl: 60,
      proxied: false,
      comment: 'managed-by-someone-else',
    });
    await expect(
      applyProvisioning({
        projectRoot: conflictProject.root,
        plan: conflictProject.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: conflictProvider.fetch }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      (await readProvisioningState(conflictProject.root))?.actions.find(
        (action) => action.action_id === 'cloudflare.dns-record',
      )?.error?.code,
    ).toBe('CLOUDFLARE_DNS_RECORD_CONFLICT');
  });

  it('stops at the paid-upgrade gate and fails DNS zone preflight before mutation', async () => {
    const paidProject = await createGeneratedProject();
    const paidProvider = new MockProviderApi();
    paidProvider.vercelDomainNeedsUpgrade = true;
    await expect(
      applyProvisioning({
        projectRoot: paidProject.root,
        plan: paidProject.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: paidProvider.fetch }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      (await readProvisioningState(paidProject.root))?.actions.find(
        (action) => action.action_id === 'vercel.project-domain',
      )?.error?.code,
    ).toBe('VERCEL_PAID_UPGRADE_APPROVAL_REQUIRED');
    expect(paidProvider.dnsRecords).toHaveLength(0);

    const zoneProject = await createGeneratedProject();
    const zoneProvider = new MockProviderApi();
    zoneProvider.cloudflareZoneAccessible = false;
    await expect(
      applyProvisioning({
        projectRoot: zoneProject.root,
        plan: zoneProject.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: zoneProvider.fetch }),
      }),
    ).rejects.toThrow(/cloudflare request returned HTTP 404/);
    expect(await readProvisioningState(zoneProject.root)).toBeNull();
    expect(zoneProvider.requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('resumes the R2 binding with bucket-scoped runtime credentials without recreating the bucket', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    const controlCredentials = {
      githubToken: credentials.githubToken,
      vercelToken: credentials.vercelToken,
      neonApiKey: credentials.neonApiKey,
      cloudflareApiToken: credentials.cloudflareApiToken,
      sentryApiToken: credentials.sentryApiToken,
      posthogPersonalApiKey: credentials.posthogPersonalApiKey,
    };

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({
          credentials: controlCredentials,
          fetch: provider.fetch,
        }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);

    const partialState = await readProvisioningState(project.root);
    expect(
      partialState?.actions.find((action) => action.action_id === 'cloudflare.r2-bucket'),
    ).toMatchObject({ attempts: 1, status: 'succeeded' });
    expect(
      partialState?.actions.find((action) => action.action_id === 'vercel.r2-binding'),
    ).toMatchObject({
      attempts: 1,
      error: { code: 'CLOUDFLARE_R2_RUNTIME_CREDENTIAL_MISSING', retryable: true },
      status: 'failed',
    });

    const resumedState = await applyProvisioning({
      projectRoot: project.root,
      plan: project.plan,
      adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      requireExistingState: true,
    });

    expect(resumedState.status).toBe('succeeded');
    expect(
      resumedState.actions.find((action) => action.action_id === 'cloudflare.r2-bucket'),
    ).toMatchObject({ attempts: 1, status: 'succeeded' });
    expect(
      resumedState.actions.find((action) => action.action_id === 'vercel.r2-binding'),
    ).toMatchObject({ attempts: 2, status: 'succeeded' });
    expect(
      provider.requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.url.hostname === 'api.cloudflare.com' &&
          request.url.pathname.endsWith('/r2/buckets'),
      ),
    ).toHaveLength(1);
  });

  it('applies the browser access rule and reads it back before accepting it', async () => {
    const manifest = parseBuildManifest(canonicalManifest);
    const root = await mkdtemp(join(tmpdir(), 'void-starter-live-cors-test-'));
    temporaryRoots.push(root);
    await mkdir(join(root, '.void-starter'));
    await writeFile(
      join(root, '.void-starter/manifest.json'),
      serializeCanonicalJson(manifest),
      'utf8',
    );
    const plan = createProvisioningPlan(manifest, corsContext);
    const provider = new MockProviderApi();
    provider.r2BucketExists = true;

    const state = await applyProvisioning({
      projectRoot: root,
      plan,
      adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
    });

    expect(state.actions.find((action) => action.action_id === 'cloudflare.r2-cors')).toMatchObject(
      { attempts: 1, status: 'succeeded' },
    );
    const put = provider.requests.find(
      (request) => request.method === 'PUT' && request.url.pathname.endsWith('/cors'),
    );
    expect(put?.body).toEqual({
      rules: [
        {
          allowed: {
            methods: ['GET', 'HEAD', 'PUT'],
            origins: ['https://app.example.com', 'http://localhost:3000'],
            headers: ['content-type'],
          },
          maxAgeSeconds: 3600,
        },
      ],
    });
  });

  it('fails when the bucket does not report the origins it just accepted', async () => {
    // An accepted PUT is not proof. A rule that did not take makes every browser
    // upload fail before the request leaves the page, which looks like a broken
    // signature and is invisible to the server.
    const manifest = parseBuildManifest(canonicalManifest);
    const root = await mkdtemp(join(tmpdir(), 'void-starter-live-cors-fail-test-'));
    temporaryRoots.push(root);
    await mkdir(join(root, '.void-starter'));
    await writeFile(
      join(root, '.void-starter/manifest.json'),
      serializeCanonicalJson(manifest),
      'utf8',
    );
    const provider = new MockProviderApi();
    provider.r2BucketExists = true;
    provider.corsAppliesNothing = true;

    await expect(
      applyProvisioning({
        projectRoot: root,
        plan: createProvisioningPlan(manifest, corsContext),
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);

    const state = await readProvisioningState(root);
    expect(
      state?.actions.find((action) => action.action_id === 'cloudflare.r2-cors'),
    ).toMatchObject({
      error: { code: 'CLOUDFLARE_R2_CORS_NOT_APPLIED', retryable: true },
      status: 'failed',
    });
  });

  it('refuses to bind runtime credentials that do not open the bucket', async () => {
    // The bucket canary runs through the Cloudflare API with the control token,
    // so nothing else in the pipeline ever exercises the runtime pair. Without
    // this check a pair scoped to another bucket binds cleanly and leaves a
    // green receipt on an application that cannot write a single object.
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.r2CredentialsWrongScope = true;

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);

    const state = await readProvisioningState(project.root);
    expect(state?.actions.find((action) => action.action_id === 'vercel.r2-binding')).toMatchObject(
      {
        error: { code: 'CLOUDFLARE_R2_RUNTIME_CREDENTIAL_SCOPE', retryable: true },
        status: 'failed',
      },
    );
    // No R2 variable reached Vercel: the check runs before the binding, so the
    // credentials are never written anywhere. (The database binding runs
    // earlier and legitimately posts to the same endpoint.)
    expect(
      provider.requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.url.pathname.includes('/env') &&
          JSON.stringify(request.body).includes('R2_'),
      ),
    ).toHaveLength(0);
  });

  it('resumes the Sentry binding with a separate build token without recreating the project', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    const controlCredentials = {
      githubToken: credentials.githubToken,
      vercelToken: credentials.vercelToken,
      neonApiKey: credentials.neonApiKey,
      cloudflareApiToken: credentials.cloudflareApiToken,
      r2AccessKeyId: credentials.r2AccessKeyId,
      r2SecretAccessKey: credentials.r2SecretAccessKey,
      sentryApiToken: credentials.sentryApiToken,
      posthogPersonalApiKey: credentials.posthogPersonalApiKey,
    };

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({
          credentials: controlCredentials,
          fetch: provider.fetch,
        }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);

    const partialState = await readProvisioningState(project.root);
    expect(
      partialState?.actions.find((action) => action.action_id === 'sentry.project'),
    ).toMatchObject({ attempts: 1, status: 'succeeded' });
    expect(
      partialState?.actions.find((action) => action.action_id === 'vercel.sentry-binding'),
    ).toMatchObject({
      attempts: 1,
      error: { code: 'SENTRY_BUILD_AUTH_TOKEN_MISSING', retryable: true },
      status: 'failed',
    });

    const resumedState = await applyProvisioning({
      projectRoot: project.root,
      plan: project.plan,
      adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      requireExistingState: true,
    });

    expect(resumedState.status).toBe('succeeded');
    expect(
      resumedState.actions.find((action) => action.action_id === 'sentry.project'),
    ).toMatchObject({ attempts: 1, status: 'succeeded' });
    expect(
      resumedState.actions.find((action) => action.action_id === 'vercel.sentry-binding'),
    ).toMatchObject({ attempts: 2, status: 'succeeded' });
    expect(
      provider.requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.url.hostname === 'de.sentry.io' &&
          request.url.pathname.endsWith('/platform/projects/'),
      ),
    ).toHaveLength(1);
  });

  it('never repeats an ambiguous Neon create while resume can only reconcile it', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.failNeonCreateWithNetwork = true;
    const adapter = new LiveProvisioningAdapter({
      credentials,
      fetch: provider.fetch,
    });

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter,
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect((await readProvisioningState(project.root))?.actions[2]?.error?.code).toBe(
      'NEON_CREATE_AMBIGUOUS',
    );

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({
          credentials,
          fetch: provider.fetch,
        }),
        requireExistingState: true,
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      provider.requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.url.hostname === 'console.neon.tech' &&
          request.url.pathname === '/api/v2/projects',
      ),
    ).toHaveLength(1);
  });

  it('never repeats an ambiguous R2 create while resume can only reconcile it', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.failR2CreateWithNetwork = true;

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      (await readProvisioningState(project.root))?.actions.find(
        (action) => action.action_id === 'cloudflare.r2-bucket',
      )?.error?.code,
    ).toBe('CLOUDFLARE_R2_CREATE_AMBIGUOUS');

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
        requireExistingState: true,
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      provider.requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.url.hostname === 'api.cloudflare.com' &&
          request.url.pathname.endsWith('/r2/buckets'),
      ),
    ).toHaveLength(1);
  });

  it('never repeats an ambiguous Sentry create while resume can only reconcile it', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.failSentryCreateWithNetwork = true;

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      (await readProvisioningState(project.root))?.actions.find(
        (action) => action.action_id === 'sentry.project',
      )?.error?.code,
    ).toBe('SENTRY_PROJECT_CREATE_AMBIGUOUS');

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
        requireExistingState: true,
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      provider.requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.url.hostname === 'de.sentry.io' &&
          request.url.pathname.endsWith('/platform/projects/'),
      ),
    ).toHaveLength(1);
  });

  it('never repeats an ambiguous PostHog project create while resume can only reconcile it', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.failPosthogCreateWithNetwork = true;

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      (await readProvisioningState(project.root))?.actions.find(
        (action) => action.action_id === 'posthog.project',
      )?.error?.code,
    ).toBe('POSTHOG_PROJECT_CREATE_AMBIGUOUS');

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
        requireExistingState: true,
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      provider.requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.url.hostname === 'eu.posthog.com' &&
          request.url.pathname === `/api/organizations/${posthogOrganizationId}/projects/`,
      ),
    ).toHaveLength(1);
  });

  it('never repeats an ambiguous PostHog binding create and rejects foreign ownership', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.failPosthogBindingWithNetwork = true;

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      (await readProvisioningState(project.root))?.actions.find(
        (action) => action.action_id === 'vercel.posthog-binding',
      )?.error?.code,
    ).toBe('VERCEL_POSTHOG_BINDING_CREATE_AMBIGUOUS');

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
        requireExistingState: true,
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      provider.requests.filter(
        (request) =>
          request.method === 'POST' &&
          Array.isArray(request.body) &&
          request.body.some(
            (variable: { key?: string }) => variable.key === 'VOID_STARTER_POSTHOG_BINDING_ID',
          ),
      ),
    ).toHaveLength(1);

    const conflictProject = await createGeneratedProject();
    const conflictProvider = new MockProviderApi();
    conflictProvider.posthogProjectExists = true;
    conflictProvider.posthogBindingMarker = 'foreign-plan';
    await expect(
      applyProvisioning({
        projectRoot: conflictProject.root,
        plan: conflictProject.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: conflictProvider.fetch }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      (await readProvisioningState(conflictProject.root))?.actions.find(
        (action) => action.action_id === 'vercel.posthog-binding',
      )?.error?.code,
    ).toBe('VERCEL_POSTHOG_BINDING_CONFLICT');
  });

  it('rejects an R2 bucket exposed through a public domain before the object canary or binding', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.r2BucketExists = true;
    provider.r2PublicDomainEnabled = true;

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      (await readProvisioningState(project.root))?.actions.find(
        (action) => action.action_id === 'cloudflare.r2-bucket',
      )?.error?.code,
    ).toBe('CLOUDFLARE_R2_PUBLIC_ACCESS_CONFLICT');
    expect(provider.requests.some((request) => request.method === 'PUT')).toBe(false);
    expect(provider.r2BindingMarker).toBeNull();
  });

  it('fails preflight before state or mutation when a provider identity is wrong', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.neonOrganizationAccessible = false;

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({
          credentials,
          fetch: provider.fetch,
        }),
      }),
    ).rejects.toThrow(/organization/i);
    expect(await readProvisioningState(project.root)).toBeNull();
    expect(provider.requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('fails preflight before state or mutation when Sentry is outside the DE region', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.sentryRegionUrl = 'https://us.sentry.io';

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      }),
    ).rejects.toThrow(/requested active DE organization/);
    expect(await readProvisioningState(project.root)).toBeNull();
    expect(provider.requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('fails preflight before state or mutation when the PostHog organization is inaccessible', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.posthogOrganizationAccessible = false;

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      }),
    ).rejects.toThrow(/posthog request returned HTTP 404/);
    expect(await readProvisioningState(project.root)).toBeNull();
    expect(provider.requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('explains the GitHub organization membership permission required by preflight', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.githubMembershipPermissionDenied = true;

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({
          credentials,
          fetch: provider.fetch,
        }),
      }),
    ).rejects.toThrow(/Members: read/);
    expect(await readProvisioningState(project.root)).toBeNull();
    expect(provider.requests.some((request) => request.method === 'POST')).toBe(false);
  });
});

describe('loadLiveProvisioningCredentials', () => {
  it('requires only credentials for providers selected by the plan', () => {
    const mobilePlan = createProvisioningPlan(
      parseBuildManifest(mobileOnlyManifest),
      parseProvisioningContext({
        schema_version: 1,
        github: context.github,
      }),
    );

    expect(
      loadLiveProvisioningCredentials(
        {
          GITHUB_TOKEN: 'github-only',
        },
        mobilePlan,
      ),
    ).toEqual({
      githubToken: 'github-only',
    });
    expect(() =>
      loadLiveProvisioningCredentials(
        {
          GITHUB_TOKEN: 'github-only',
        },
        createProvisioningPlan(parseBuildManifest(canonicalManifest), context),
      ),
    ).toThrow(/VERCEL_TOKEN/);

    const canonicalPlan = createProvisioningPlan(parseBuildManifest(canonicalManifest), context);
    expect(() =>
      loadLiveProvisioningCredentials(
        {
          GITHUB_TOKEN: 'github',
          VERCEL_TOKEN: 'vercel',
          NEON_API_KEY: 'neon',
        },
        canonicalPlan,
      ),
    ).toThrow(/CLOUDFLARE_API_TOKEN/);
    expect(() =>
      loadLiveProvisioningCredentials(
        {
          GITHUB_TOKEN: 'github',
          VERCEL_TOKEN: 'vercel',
          NEON_API_KEY: 'neon',
          CLOUDFLARE_API_TOKEN: 'cloudflare',
        },
        canonicalPlan,
      ),
    ).toThrow(/SENTRY_API_TOKEN/);
    expect(() =>
      loadLiveProvisioningCredentials(
        {
          GITHUB_TOKEN: 'github',
          VERCEL_TOKEN: 'vercel',
          NEON_API_KEY: 'neon',
          CLOUDFLARE_API_TOKEN: 'cloudflare',
          SENTRY_API_TOKEN: 'sentry-control',
        },
        canonicalPlan,
      ),
    ).toThrow(/POSTHOG_PERSONAL_API_KEY/);
    expect(() =>
      loadLiveProvisioningCredentials(
        {
          GITHUB_TOKEN: 'github',
          VERCEL_TOKEN: 'vercel',
          NEON_API_KEY: 'neon',
          CLOUDFLARE_API_TOKEN: 'cloudflare',
          SENTRY_API_TOKEN: 'sentry-control',
          POSTHOG_PERSONAL_API_KEY: 'posthog-control',
        },
        canonicalPlan,
      ),
    ).not.toThrow();
    expect(() =>
      loadLiveProvisioningCredentials(
        {
          GITHUB_TOKEN: 'github',
          VERCEL_TOKEN: 'vercel',
          NEON_API_KEY: 'neon',
          CLOUDFLARE_API_TOKEN: 'cloudflare',
          SENTRY_API_TOKEN: 'sentry-control',
          R2_ACCESS_KEY_ID: 'partial-r2-credential',
        },
        canonicalPlan,
      ),
    ).toThrow(/R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY together/);
  });
});
