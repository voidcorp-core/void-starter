import { z } from 'zod';
import { sha256 } from './integrity.service';
import type {
  ProvisionedResource,
  ProvisioningAction,
  ProvisioningPlan,
} from './provisioning.types';
import {
  type ProvisioningAdapter,
  ProvisioningAdapterError,
  type ProvisioningExecutionContext,
} from './provisioning-apply.service';

const GITHUB_API = 'https://api.github.com';
const VERCEL_API = 'https://api.vercel.com';
const NEON_API = 'https://console.neon.tech/api/v2';
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
const POSTHOG_API = 'https://eu.posthog.com/api';
const DATABASE_BINDING_MARKER = 'VOID_STARTER_DATABASE_BINDING_ID';
const R2_BINDING_MARKER = 'VOID_STARTER_R2_BINDING_ID';
const SENTRY_BINDING_MARKER = 'VOID_STARTER_SENTRY_BINDING_ID';
const POSTHOG_BINDING_MARKER = 'VOID_STARTER_POSTHOG_BINDING_ID';
const DATABASE_SENSITIVE_TARGETS = ['preview', 'production'] as const;
const DATABASE_DEVELOPMENT_TARGETS = ['development'] as const;
const DATABASE_MARKER_TARGETS = ['development', 'preview', 'production'] as const;
const R2_BINDING_KEYS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_BUCKET_NAME',
  'R2_ENDPOINT',
  'R2_SECRET_ACCESS_KEY',
] as const;
const R2_SECRET_KEYS = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const;
const R2_NON_SECRET_KEYS = ['CLOUDFLARE_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ENDPOINT'] as const;
const SENTRY_BINDING_KEYS = [
  'SENTRY_DSN',
  'NEXT_PUBLIC_SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
] as const;
const SENTRY_SECRET_KEYS = ['SENTRY_AUTH_TOKEN'] as const;
const SENTRY_NON_SECRET_KEYS = [
  'SENTRY_DSN',
  'NEXT_PUBLIC_SENTRY_DSN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
] as const;
const POSTHOG_BINDING_KEYS = ['NEXT_PUBLIC_POSTHOG_KEY', 'NEXT_PUBLIC_POSTHOG_HOST'] as const;

type Provider = 'github' | 'vercel' | 'neon' | 'cloudflare' | 'sentry' | 'posthog';
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type LiveProvisioningCredentials = {
  githubToken: string;
  vercelToken?: string;
  neonApiKey?: string;
  cloudflareApiToken?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  sentryApiToken?: string;
  sentryBuildAuthToken?: string;
  posthogPersonalApiKey?: string;
};

export type LiveProvisioningAdapterOptions = {
  credentials: LiveProvisioningCredentials;
  fetch?: FetchLike;
  timeoutMs?: number;
};

class ProviderHttpFailure extends ProvisioningAdapterError {
  readonly ambiguousMutation: boolean;

  constructor(input: {
    code: string;
    message: string;
    retryable: boolean;
    ambiguousMutation: boolean;
  }) {
    super({
      code: input.code,
      message: input.message,
      retryable: input.retryable,
    });
    this.name = 'ProviderHttpFailure';
    this.ambiguousMutation = input.ambiguousMutation;
  }
}

const githubUserSchema = z.object({
  login: z.string().min(1),
});

const githubMembershipSchema = z.object({
  state: z.enum(['active', 'pending']),
  organization: z.object({
    login: z.string().min(1),
  }),
});

const githubRepositorySchema = z.object({
  node_id: z.string().min(1),
  full_name: z.string().min(1),
  private: z.boolean(),
});

const vercelTeamSchema = z.object({
  id: z.string().min(1),
});

const vercelProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  framework: z.string().nullable().optional(),
  rootDirectory: z.string().nullable().optional(),
});

const neonOrganizationSchema = z.object({
  id: z.string().min(1),
});

const neonOrganizationsSchema = z
  .union([
    z.array(neonOrganizationSchema),
    z.object({
      organizations: z.array(neonOrganizationSchema),
    }),
  ])
  .transform((value) => (Array.isArray(value) ? value : value.organizations));

const neonProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  region_id: z.string().min(1),
});

const neonProjectsSchema = z.object({
  projects: z.array(neonProjectSchema),
});

const neonConnectionUriSchema = z
  .union([
    z.object({
      uri: z.string().url(),
    }),
    z.object({
      connection_uri: z.string().url(),
    }),
  ])
  .transform((value) => ('uri' in value ? value.uri : value.connection_uri));

const vercelEnvironmentVariableSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  type: z.string().optional(),
  value: z.string().optional(),
  target: z.array(z.string()).optional(),
});

const vercelEnvironmentVariablesSchema = z.object({
  envs: z.array(vercelEnvironmentVariableSchema),
});

const cloudflareBucketSchema = z.object({
  name: z.string().min(3),
  jurisdiction: z.enum(['default', 'eu', 'fedramp']).optional(),
  storage_class: z.enum(['Standard', 'InfrequentAccess']).optional(),
});

const cloudflareBucketResponseSchema = z.object({
  success: z.literal(true),
  result: cloudflareBucketSchema,
});

const cloudflareBucketListResponseSchema = z.object({
  success: z.literal(true),
  result: z.object({
    buckets: z.array(cloudflareBucketSchema),
  }),
});

const cloudflareManagedDomainResponseSchema = z.object({
  success: z.literal(true),
  result: z.object({
    bucketId: z.string().min(1),
    domain: z.string().min(1),
    enabled: z.boolean(),
  }),
});

const cloudflareCustomDomainsResponseSchema = z.object({
  success: z.literal(true),
  result: z.object({
    domains: z.array(
      z.object({
        domain: z.string().min(1),
        enabled: z.boolean(),
      }),
    ),
  }),
});

const cloudflareObjectUploadResponseSchema = z.object({
  success: z.literal(true),
  result: z.object({
    key: z.string().min(1),
    etag: z.string().min(1),
  }),
});

const sentryOrganizationSchema = z.object({
  slug: z.string().min(1),
  status: z.object({ id: z.string().min(1) }),
  links: z.object({ regionUrl: z.string().url() }),
});

const sentryTeamSchema = z.object({
  slug: z.string().min(1),
  hasAccess: z.boolean(),
  organization: z.object({ slug: z.string().min(1) }).optional(),
});

const sentryProjectSchema = z.object({
  id: z.union([z.string().min(1), z.number().int().positive()]).transform(String),
  slug: z.string().min(1),
  name: z.string().min(1),
  platform: z.string().nullable().optional(),
  status: z.string().optional(),
  teams: z.array(z.object({ slug: z.string().min(1) })),
});

const sentryClientKeySchema = z.object({
  id: z.string().min(1),
  projectId: z.union([z.string().min(1), z.number().int().positive()]).transform(String),
  isActive: z.boolean(),
  dsn: z.object({ public: z.string().url() }),
});

const sentryClientKeysSchema = z.array(sentryClientKeySchema);

const posthogOrganizationSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/),
});

const posthogProjectSchema = z.object({
  id: z.union([z.string().min(1), z.number().int().positive()]).transform(String),
  organization: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/),
  name: z.string().min(1),
  api_token: z.string().min(1),
});

const posthogProjectsSchema = z.object({
  count: z.number().int().nonnegative(),
  results: z.array(posthogProjectSchema),
});

function requiredCredential(
  environment: Record<string, string | undefined>,
  name:
    | 'GITHUB_TOKEN'
    | 'VERCEL_TOKEN'
    | 'NEON_API_KEY'
    | 'CLOUDFLARE_API_TOKEN'
    | 'R2_ACCESS_KEY_ID'
    | 'R2_SECRET_ACCESS_KEY'
    | 'SENTRY_API_TOKEN'
    | 'SENTRY_BUILD_AUTH_TOKEN'
    | 'POSTHOG_PERSONAL_API_KEY',
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Live provisioning requires ${name}`);
  }
  return value;
}

export function loadLiveProvisioningCredentials(
  environment: Record<string, string | undefined>,
  plan: ProvisioningPlan,
): LiveProvisioningCredentials {
  const usesVercel = plan.actions.some((action) => action.provider === 'vercel');
  const usesNeon = plan.actions.some((action) => action.provider === 'neon');
  const usesCloudflare = plan.actions.some((action) => action.provider === 'cloudflare');
  const usesR2Binding = plan.actions.some((action) => action.id === 'vercel.r2-binding');
  const usesSentry = plan.actions.some((action) => action.provider === 'sentry');
  const usesSentryBinding = plan.actions.some((action) => action.id === 'vercel.sentry-binding');
  const usesPosthog = plan.actions.some((action) => action.provider === 'posthog');
  const r2AccessKeyId = usesR2Binding ? environment['R2_ACCESS_KEY_ID']?.trim() : undefined;
  const r2SecretAccessKey = usesR2Binding ? environment['R2_SECRET_ACCESS_KEY']?.trim() : undefined;
  if (Boolean(r2AccessKeyId) !== Boolean(r2SecretAccessKey)) {
    throw new Error(
      'Live provisioning requires R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY together',
    );
  }
  return {
    githubToken: requiredCredential(environment, 'GITHUB_TOKEN'),
    ...(usesVercel ? { vercelToken: requiredCredential(environment, 'VERCEL_TOKEN') } : {}),
    ...(usesNeon ? { neonApiKey: requiredCredential(environment, 'NEON_API_KEY') } : {}),
    ...(usesCloudflare
      ? { cloudflareApiToken: requiredCredential(environment, 'CLOUDFLARE_API_TOKEN') }
      : {}),
    ...(usesSentry ? { sentryApiToken: requiredCredential(environment, 'SENTRY_API_TOKEN') } : {}),
    ...(usesSentryBinding && environment['SENTRY_BUILD_AUTH_TOKEN']?.trim()
      ? { sentryBuildAuthToken: environment['SENTRY_BUILD_AUTH_TOKEN'].trim() }
      : {}),
    ...(usesPosthog
      ? { posthogPersonalApiKey: requiredCredential(environment, 'POSTHOG_PERSONAL_API_KEY') }
      : {}),
    ...(r2AccessKeyId && r2SecretAccessKey
      ? {
          r2AccessKeyId,
          r2SecretAccessKey,
        }
      : {}),
  };
}

function providerCode(provider: Provider, suffix: string): string {
  return `${provider.toUpperCase()}_${suffix}`;
}

function adapterFailure(
  provider: Provider,
  suffix: string,
  message: string,
  retryable = false,
): ProvisioningAdapterError {
  return new ProvisioningAdapterError({
    code: providerCode(provider, suffix),
    message,
    retryable,
  });
}

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function encodedObjectKey(value: string): string {
  return value.split('/').map(encoded).join('/');
}

function sentryApi(region: 'de'): string {
  return `https://${region}.sentry.io/api/0`;
}

function withQuery(base: string, parameters: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function hasExactTargets(targets: string[] | undefined, expected: readonly string[]): boolean {
  return (
    targets?.length === expected.length && expected.every((target) => targets.includes(target))
  );
}

function requireDependency(
  context: ProvisioningExecutionContext,
  actionId: ProvisioningAction['id'],
): ProvisionedResource {
  const resource = context.resources.get(actionId);
  if (!resource) {
    throw new Error(`Live adapter is missing dependency resource ${actionId}`);
  }
  return resource;
}

export class LiveProvisioningAdapter implements ProvisioningAdapter {
  readonly mode = 'live' as const;
  readonly #credentials: LiveProvisioningCredentials;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(options: LiveProvisioningAdapterOptions) {
    this.#credentials = options.credentials;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
  }

  async #request(input: {
    provider: Provider;
    url: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    rawBody?: Exclude<RequestInit['body'], null>;
    headers?: Record<string, string>;
    acceptedStatuses: number[];
  }): Promise<Response> {
    const method = input.method ?? 'GET';
    const token =
      input.provider === 'github'
        ? this.#credentials.githubToken
        : input.provider === 'vercel'
          ? this.#credentials.vercelToken
          : input.provider === 'neon'
            ? this.#credentials.neonApiKey
            : input.provider === 'cloudflare'
              ? this.#credentials.cloudflareApiToken
              : input.provider === 'sentry'
                ? this.#credentials.sentryApiToken
                : this.#credentials.posthogPersonalApiKey;
    if (!token) {
      throw adapterFailure(
        input.provider,
        'CREDENTIAL_MISSING',
        `${input.provider} credential is missing`,
      );
    }
    const headers: Record<string, string> = {
      Accept: input.provider === 'github' ? 'application/vnd.github+json' : 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'void-starter-factory',
      ...input.headers,
    };
    if (input.provider === 'github') {
      headers['X-GitHub-Api-Version'] = '2026-03-10';
    }
    if (input.body !== undefined && input.rawBody !== undefined) {
      throw new Error('Provider request cannot contain JSON and raw bodies together');
    }
    if (input.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await this.#fetch(input.url, {
        method,
        headers,
        ...(input.body === undefined
          ? input.rawBody === undefined
            ? {}
            : { body: input.rawBody }
          : { body: JSON.stringify(input.body) }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new ProviderHttpFailure({
        code: providerCode(input.provider, 'NETWORK_FAILURE'),
        message: `${input.provider} request failed before a response was confirmed`,
        retryable: true,
        ambiguousMutation: method !== 'GET',
      });
    }

    if (!input.acceptedStatuses.includes(response.status)) {
      throw new ProviderHttpFailure({
        code: providerCode(input.provider, `HTTP_${response.status}`),
        message: `${input.provider} request returned HTTP ${response.status}`,
        retryable: response.status === 423 || response.status === 429 || response.status >= 500,
        ambiguousMutation: method !== 'GET' && response.status >= 500,
      });
    }
    return response;
  }

  async #json<T>(provider: Provider, response: Response, schema: z.ZodType<T>): Promise<T> {
    try {
      return schema.parse(await response.json());
    } catch {
      throw adapterFailure(
        provider,
        'INVALID_RESPONSE',
        `${provider} returned an invalid response`,
      );
    }
  }

  async preflight(plan: ProvisioningPlan): Promise<void> {
    const githubAction = plan.actions.find((action) => action.id === 'github.repository');
    const vercelAction = plan.actions.find((action) => action.id === 'vercel.project');
    const neonAction = plan.actions.find((action) => action.id === 'neon.project');
    const cloudflareAction = plan.actions.find((action) => action.id === 'cloudflare.r2-bucket');
    const sentryAction = plan.actions.find((action) => action.id === 'sentry.project');
    const posthogAction = plan.actions.find((action) => action.id === 'posthog.project');

    await Promise.all([
      githubAction ? this.#preflightGithub(githubAction) : Promise.resolve(),
      vercelAction ? this.#preflightVercel(vercelAction) : Promise.resolve(),
      neonAction ? this.#preflightNeon(neonAction) : Promise.resolve(),
      cloudflareAction ? this.#preflightCloudflare(cloudflareAction) : Promise.resolve(),
      sentryAction ? this.#preflightSentry(sentryAction) : Promise.resolve(),
      posthogAction ? this.#preflightPosthog(posthogAction) : Promise.resolve(),
    ]);
  }

  async #preflightGithub(
    action: Extract<ProvisioningAction, { id: 'github.repository' }>,
  ): Promise<void> {
    const userResponse = await this.#request({
      provider: 'github',
      url: `${GITHUB_API}/user`,
      acceptedStatuses: [200],
    });
    const user = await this.#json('github', userResponse, githubUserSchema);

    if (action.input.owner_kind === 'user') {
      if (user.login.toLowerCase() !== action.input.owner.toLowerCase()) {
        throw adapterFailure(
          'github',
          'OWNER_MISMATCH',
          'Authenticated GitHub user does not match the requested owner',
        );
      }
      return;
    }

    const membershipResponse = await this.#request({
      provider: 'github',
      url: `${GITHUB_API}/user/memberships/orgs/${encoded(action.input.owner)}`,
      acceptedStatuses: [200, 403, 404],
    });
    if (membershipResponse.status === 403) {
      throw adapterFailure(
        'github',
        'MEMBERS_PERMISSION_REQUIRED',
        'GitHub organization preflight requires Organization permissions > Members: read',
      );
    }
    if (membershipResponse.status === 404) {
      throw adapterFailure(
        'github',
        'ORGANIZATION_MISMATCH',
        'Authenticated GitHub user is not a member of the requested organization',
      );
    }
    const membership = await this.#json('github', membershipResponse, githubMembershipSchema);
    if (
      membership.state !== 'active' ||
      membership.organization.login.toLowerCase() !== action.input.owner.toLowerCase()
    ) {
      throw adapterFailure(
        'github',
        'ORGANIZATION_MISMATCH',
        'Authenticated GitHub user is not an active member of the requested organization',
      );
    }
  }

  async #preflightVercel(
    action: Extract<ProvisioningAction, { id: 'vercel.project' }>,
  ): Promise<void> {
    const response = await this.#request({
      provider: 'vercel',
      url: `${VERCEL_API}/v2/teams/${encoded(action.input.team_id)}`,
      acceptedStatuses: [200],
    });
    const team = await this.#json('vercel', response, vercelTeamSchema);
    if (team.id !== action.input.team_id) {
      throw adapterFailure(
        'vercel',
        'TEAM_MISMATCH',
        'Authenticated Vercel team does not match the requested team',
      );
    }
    this.#currentVercelTeamId = team.id;
  }

  async #preflightNeon(action: Extract<ProvisioningAction, { id: 'neon.project' }>): Promise<void> {
    const response = await this.#request({
      provider: 'neon',
      url: `${NEON_API}/users/me/organizations`,
      acceptedStatuses: [200],
    });
    const organizations = await this.#json('neon', response, neonOrganizationsSchema);
    if (!organizations.some((organization) => organization.id === action.input.org_id)) {
      throw adapterFailure(
        'neon',
        'ORGANIZATION_MISMATCH',
        'Authenticated Neon key cannot access the requested organization',
      );
    }
  }

  async #preflightCloudflare(
    action: Extract<ProvisioningAction, { id: 'cloudflare.r2-bucket' }>,
  ): Promise<void> {
    const response = await this.#request({
      provider: 'cloudflare',
      url: `${CLOUDFLARE_API}/accounts/${encoded(action.input.account_id)}/r2/buckets`,
      headers: { 'cf-r2-jurisdiction': action.input.jurisdiction },
      acceptedStatuses: [200],
    });
    await this.#json('cloudflare', response, cloudflareBucketListResponseSchema);
  }

  async #preflightSentry(
    action: Extract<ProvisioningAction, { id: 'sentry.project' }>,
  ): Promise<void> {
    const api = sentryApi(action.input.region);
    const [organizationResponse, teamResponse] = await Promise.all([
      this.#request({
        provider: 'sentry',
        url: withQuery(`${api}/organizations/${encoded(action.input.organization_slug)}/`, {
          detailed: '0',
        }),
        acceptedStatuses: [200],
      }),
      this.#request({
        provider: 'sentry',
        url: `${api}/teams/${encoded(action.input.organization_slug)}/${encoded(action.input.team_slug)}/`,
        acceptedStatuses: [200],
      }),
    ]);
    const organization = await this.#json('sentry', organizationResponse, sentryOrganizationSchema);
    const team = await this.#json('sentry', teamResponse, sentryTeamSchema);
    if (
      organization.slug !== action.input.organization_slug ||
      organization.status.id !== 'active' ||
      new URL(organization.links.regionUrl).hostname !== `${action.input.region}.sentry.io`
    ) {
      throw adapterFailure(
        'sentry',
        'ORGANIZATION_MISMATCH',
        'Authenticated Sentry token does not target the requested active DE organization',
      );
    }
    if (
      team.slug !== action.input.team_slug ||
      !team.hasAccess ||
      (team.organization && team.organization.slug !== action.input.organization_slug)
    ) {
      throw adapterFailure(
        'sentry',
        'TEAM_MISMATCH',
        'Authenticated Sentry token cannot access the requested team',
      );
    }
  }

  async #preflightPosthog(
    action: Extract<ProvisioningAction, { id: 'posthog.project' }>,
  ): Promise<void> {
    const response = await this.#request({
      provider: 'posthog',
      url: `${POSTHOG_API}/organizations/${encoded(action.input.organization_id)}/`,
      acceptedStatuses: [200],
    });
    const organization = await this.#json('posthog', response, posthogOrganizationSchema);
    if (organization.id !== action.input.organization_id) {
      throw adapterFailure(
        'posthog',
        'ORGANIZATION_MISMATCH',
        'Authenticated PostHog key cannot access the requested EU organization',
      );
    }
  }

  async ensure(
    action: ProvisioningAction,
    context: ProvisioningExecutionContext,
  ): Promise<ProvisionedResource> {
    switch (action.id) {
      case 'github.repository':
        return this.#ensureGithubRepository(action, context);
      case 'vercel.project':
        return this.#ensureVercelProject(action, context);
      case 'neon.project':
        return this.#ensureNeonProject(action, context);
      case 'vercel.database-binding':
        return this.#ensureDatabaseBinding(action, context);
      case 'cloudflare.r2-bucket':
        return this.#ensureR2Bucket(action, context);
      case 'vercel.r2-binding':
        return this.#ensureR2Binding(action, context);
      case 'sentry.project':
        return this.#ensureSentryProject(action, context);
      case 'vercel.sentry-binding':
        return this.#ensureSentryBinding(action, context);
      case 'posthog.project':
        return this.#ensurePosthogProject(action, context);
      case 'vercel.posthog-binding':
        return this.#ensurePosthogBinding(action, context);
    }
  }

  async #lookupGithubRepository(
    action: Extract<ProvisioningAction, { id: 'github.repository' }>,
  ): Promise<z.infer<typeof githubRepositorySchema> | null> {
    const response = await this.#request({
      provider: 'github',
      url: `${GITHUB_API}/repos/${encoded(action.input.owner)}/${encoded(action.input.name)}`,
      acceptedStatuses: [200, 404],
    });
    if (response.status === 404) {
      return null;
    }
    return this.#json('github', response, githubRepositorySchema);
  }

  #githubResource(
    action: Extract<ProvisioningAction, { id: 'github.repository' }>,
    repository: z.infer<typeof githubRepositorySchema>,
  ): ProvisionedResource {
    if (
      repository.full_name.toLowerCase() !==
        `${action.input.owner}/${action.input.name}`.toLowerCase() ||
      repository.private !== (action.input.visibility === 'private')
    ) {
      throw adapterFailure(
        'github',
        'RESOURCE_CONFLICT',
        'Existing GitHub repository does not match the requested ownership or visibility',
      );
    }
    return {
      provider: 'github',
      resource_kind: 'repository',
      resource_id: repository.node_id,
      display_name: repository.full_name,
    };
  }

  async #ensureGithubRepository(
    action: Extract<ProvisioningAction, { id: 'github.repository' }>,
    context: ProvisioningExecutionContext,
  ): Promise<ProvisionedResource> {
    const existing = await this.#lookupGithubRepository(action);
    if (existing) {
      return this.#githubResource(action, existing);
    }
    if (context.previousError?.code === 'GITHUB_CREATE_AMBIGUOUS') {
      throw adapterFailure(
        'github',
        'CREATE_AMBIGUOUS',
        'GitHub repository creation remains ambiguous; no second create was attempted',
        true,
      );
    }

    const url =
      action.input.owner_kind === 'organization'
        ? `${GITHUB_API}/orgs/${encoded(action.input.owner)}/repos`
        : `${GITHUB_API}/user/repos`;
    let createError: unknown;
    try {
      await this.#request({
        provider: 'github',
        url,
        method: 'POST',
        body: {
          name: action.input.name,
          private: action.input.visibility === 'private',
          auto_init: false,
        },
        acceptedStatuses: [201],
      });
    } catch (error) {
      createError = error;
    }

    const reconciled = await this.#lookupGithubRepository(action);
    if (reconciled) {
      return this.#githubResource(action, reconciled);
    }
    if (createError instanceof ProviderHttpFailure && createError.ambiguousMutation) {
      throw adapterFailure(
        'github',
        'CREATE_AMBIGUOUS',
        'GitHub repository creation is ambiguous; resume will reconcile without creating again',
        true,
      );
    }
    if (createError) {
      throw createError;
    }
    throw adapterFailure(
      'github',
      'CREATE_AMBIGUOUS',
      'GitHub accepted creation but the repository is not yet observable',
      true,
    );
  }

  async #lookupVercelProject(
    action: Extract<ProvisioningAction, { id: 'vercel.project' }>,
  ): Promise<z.infer<typeof vercelProjectSchema> | null> {
    const response = await this.#request({
      provider: 'vercel',
      url: withQuery(`${VERCEL_API}/v9/projects/${encoded(action.input.name)}`, {
        teamId: action.input.team_id,
      }),
      acceptedStatuses: [200, 404],
    });
    if (response.status === 404) {
      return null;
    }
    return this.#json('vercel', response, vercelProjectSchema);
  }

  #vercelProjectResource(
    action: Extract<ProvisioningAction, { id: 'vercel.project' }>,
    project: z.infer<typeof vercelProjectSchema>,
  ): ProvisionedResource {
    if (
      project.name !== action.input.name ||
      (project.framework !== undefined && project.framework !== action.input.framework) ||
      (project.rootDirectory !== undefined && project.rootDirectory !== action.input.root_directory)
    ) {
      throw adapterFailure(
        'vercel',
        'RESOURCE_CONFLICT',
        'Existing Vercel project does not match the requested framework or root directory',
      );
    }
    return {
      provider: 'vercel',
      resource_kind: 'project',
      resource_id: project.id,
      display_name: project.name,
    };
  }

  async #ensureVercelProject(
    action: Extract<ProvisioningAction, { id: 'vercel.project' }>,
    context: ProvisioningExecutionContext,
  ): Promise<ProvisionedResource> {
    const repository = requireDependency(context, 'github.repository');
    if (repository.provider !== 'github') {
      throw new Error('Vercel project dependency is not a GitHub repository');
    }

    const existing = await this.#lookupVercelProject(action);
    if (existing) {
      return this.#vercelProjectResource(action, existing);
    }
    if (context.previousError?.code === 'VERCEL_CREATE_AMBIGUOUS') {
      throw adapterFailure(
        'vercel',
        'CREATE_AMBIGUOUS',
        'Vercel project creation remains ambiguous; no second create was attempted',
        true,
      );
    }

    let createError: unknown;
    try {
      await this.#request({
        provider: 'vercel',
        url: withQuery(`${VERCEL_API}/v10/projects`, {
          teamId: action.input.team_id,
        }),
        method: 'POST',
        body: {
          name: action.input.name,
          framework: action.input.framework,
          rootDirectory: action.input.root_directory,
          gitRepository: {
            type: 'github',
            repo: repository.display_name,
          },
        },
        acceptedStatuses: [200, 201],
      });
    } catch (error) {
      createError = error;
    }

    const reconciled = await this.#lookupVercelProject(action);
    if (reconciled) {
      return this.#vercelProjectResource(action, reconciled);
    }
    if (createError instanceof ProviderHttpFailure && createError.ambiguousMutation) {
      throw adapterFailure(
        'vercel',
        'CREATE_AMBIGUOUS',
        'Vercel project creation is ambiguous; resume will reconcile without creating again',
        true,
      );
    }
    if (createError) {
      throw createError;
    }
    throw adapterFailure(
      'vercel',
      'CREATE_AMBIGUOUS',
      'Vercel accepted creation but the project is not yet observable',
      true,
    );
  }

  async #lookupNeonProject(
    action: Extract<ProvisioningAction, { id: 'neon.project' }>,
  ): Promise<z.infer<typeof neonProjectSchema> | null> {
    const response = await this.#request({
      provider: 'neon',
      url: withQuery(`${NEON_API}/projects`, {
        org_id: action.input.org_id,
        search: action.input.name,
        limit: '100',
      }),
      acceptedStatuses: [200],
    });
    const projects = (await this.#json('neon', response, neonProjectsSchema)).projects.filter(
      (project) => project.name === action.input.name,
    );
    if (projects.length > 1) {
      throw adapterFailure(
        'neon',
        'RESOURCE_CONFLICT',
        'More than one Neon project has the requested exact name',
      );
    }
    return projects[0] ?? null;
  }

  #neonProjectResource(
    action: Extract<ProvisioningAction, { id: 'neon.project' }>,
    project: z.infer<typeof neonProjectSchema>,
  ): ProvisionedResource {
    if (project.region_id !== action.input.region_id) {
      throw adapterFailure(
        'neon',
        'RESOURCE_CONFLICT',
        'Existing Neon project is not in the requested region',
      );
    }
    return {
      provider: 'neon',
      resource_kind: 'project',
      resource_id: project.id,
      display_name: project.name,
      database_name: 'neondb',
      role_name: 'neondb_owner',
    };
  }

  async #ensureNeonProject(
    action: Extract<ProvisioningAction, { id: 'neon.project' }>,
    context: ProvisioningExecutionContext,
  ): Promise<ProvisionedResource> {
    const existing = await this.#lookupNeonProject(action);
    if (existing) {
      return this.#neonProjectResource(action, existing);
    }
    if (context.previousError?.code === 'NEON_CREATE_AMBIGUOUS') {
      throw adapterFailure(
        'neon',
        'CREATE_AMBIGUOUS',
        'Neon project creation remains ambiguous; no second create was attempted',
        true,
      );
    }

    let createError: unknown;
    try {
      await this.#request({
        provider: 'neon',
        url: withQuery(`${NEON_API}/projects`, {
          org_id: action.input.org_id,
        }),
        method: 'POST',
        body: {
          project: {
            name: action.input.name,
            region_id: action.input.region_id,
          },
        },
        acceptedStatuses: [201],
      });
    } catch (error) {
      createError = error;
    }

    const reconciled = await this.#lookupNeonProject(action);
    if (reconciled) {
      return this.#neonProjectResource(action, reconciled);
    }
    if (createError instanceof ProviderHttpFailure && createError.ambiguousMutation) {
      throw adapterFailure(
        'neon',
        'CREATE_AMBIGUOUS',
        'Neon project creation is ambiguous; resume will reconcile without creating again',
        true,
      );
    }
    if (createError) {
      throw createError;
    }
    throw adapterFailure(
      'neon',
      'CREATE_AMBIGUOUS',
      'Neon accepted creation but the project is not yet observable',
      true,
    );
  }

  #r2BucketUrl(action: Extract<ProvisioningAction, { id: 'cloudflare.r2-bucket' }>): string {
    return `${CLOUDFLARE_API}/accounts/${encoded(action.input.account_id)}/r2/buckets/${encoded(action.input.name)}`;
  }

  async #lookupR2Bucket(
    action: Extract<ProvisioningAction, { id: 'cloudflare.r2-bucket' }>,
  ): Promise<z.infer<typeof cloudflareBucketSchema> | null> {
    const response = await this.#request({
      provider: 'cloudflare',
      url: this.#r2BucketUrl(action),
      headers: { 'cf-r2-jurisdiction': action.input.jurisdiction },
      acceptedStatuses: [200, 404],
    });
    if (response.status === 404) {
      return null;
    }
    return (await this.#json('cloudflare', response, cloudflareBucketResponseSchema)).result;
  }

  async #inspectR2Privacy(
    action: Extract<ProvisioningAction, { id: 'cloudflare.r2-bucket' }>,
  ): Promise<string> {
    const [managedResponse, customResponse] = await Promise.all([
      this.#request({
        provider: 'cloudflare',
        url: `${this.#r2BucketUrl(action)}/domains/managed`,
        headers: { 'cf-r2-jurisdiction': action.input.jurisdiction },
        acceptedStatuses: [200],
      }),
      this.#request({
        provider: 'cloudflare',
        url: `${this.#r2BucketUrl(action)}/domains/custom`,
        headers: { 'cf-r2-jurisdiction': action.input.jurisdiction },
        acceptedStatuses: [200],
      }),
    ]);
    const managed = (
      await this.#json('cloudflare', managedResponse, cloudflareManagedDomainResponseSchema)
    ).result;
    const custom = (
      await this.#json('cloudflare', customResponse, cloudflareCustomDomainsResponseSchema)
    ).result.domains;
    if (managed.enabled || custom.some((domain) => domain.enabled)) {
      throw adapterFailure(
        'cloudflare',
        'R2_PUBLIC_ACCESS_CONFLICT',
        'Existing R2 bucket exposes a public domain',
      );
    }
    return managed.bucketId;
  }

  async #runR2Canary(
    action: Extract<ProvisioningAction, { id: 'cloudflare.r2-bucket' }>,
  ): Promise<string> {
    const payload = `void-starter-r2-canary:${action.idempotency_key}\n`;
    const payloadSha256 = sha256(payload);
    const objectKey = `.void-starter/canary/${payloadSha256}.txt`;
    const objectUrl = `${this.#r2BucketUrl(action)}/objects/${encodedObjectKey(objectKey)}`;

    const uploadResponse = await this.#request({
      provider: 'cloudflare',
      url: objectUrl,
      method: 'PUT',
      rawBody: payload,
      headers: {
        'Content-Type': 'application/octet-stream',
        'cf-r2-jurisdiction': action.input.jurisdiction,
      },
      acceptedStatuses: [200],
    });
    try {
      const upload = (
        await this.#json('cloudflare', uploadResponse, cloudflareObjectUploadResponseSchema)
      ).result;
      if (upload.key !== objectKey) {
        throw adapterFailure(
          'cloudflare',
          'R2_CANARY_UPLOAD_MISMATCH',
          'R2 canary upload returned an unexpected object key',
        );
      }
      const readResponse = await this.#request({
        provider: 'cloudflare',
        url: objectUrl,
        headers: { 'cf-r2-jurisdiction': action.input.jurisdiction },
        acceptedStatuses: [200],
      });
      if ((await readResponse.text()) !== payload) {
        throw adapterFailure(
          'cloudflare',
          'R2_CANARY_READ_MISMATCH',
          'R2 canary read did not return the exact uploaded bytes',
        );
      }
    } finally {
      await this.#request({
        provider: 'cloudflare',
        url: objectUrl,
        method: 'DELETE',
        headers: { 'cf-r2-jurisdiction': action.input.jurisdiction },
        acceptedStatuses: [200],
      });
    }
    return payloadSha256;
  }

  async #r2BucketResource(
    action: Extract<ProvisioningAction, { id: 'cloudflare.r2-bucket' }>,
    bucket: z.infer<typeof cloudflareBucketSchema>,
  ): Promise<ProvisionedResource> {
    if (
      bucket.name !== action.input.name ||
      bucket.jurisdiction !== action.input.jurisdiction ||
      (bucket.storage_class !== undefined && bucket.storage_class !== action.input.storage_class)
    ) {
      throw adapterFailure(
        'cloudflare',
        'R2_RESOURCE_CONFLICT',
        'Existing R2 bucket does not match the requested jurisdiction or storage class',
      );
    }
    const resourceId = await this.#inspectR2Privacy(action);
    const canarySha256 = await this.#runR2Canary(action);
    return {
      provider: 'cloudflare',
      resource_kind: 'r2-bucket',
      resource_id: resourceId,
      display_name: bucket.name,
      account_id: action.input.account_id,
      jurisdiction: 'eu',
      public_access: false,
      canary_sha256: canarySha256,
    };
  }

  async #ensureR2Bucket(
    action: Extract<ProvisioningAction, { id: 'cloudflare.r2-bucket' }>,
    context: ProvisioningExecutionContext,
  ): Promise<ProvisionedResource> {
    const existing = await this.#lookupR2Bucket(action);
    if (existing) {
      return this.#r2BucketResource(action, existing);
    }
    if (context.previousError?.code === 'CLOUDFLARE_R2_CREATE_AMBIGUOUS') {
      throw adapterFailure(
        'cloudflare',
        'R2_CREATE_AMBIGUOUS',
        'R2 bucket creation remains ambiguous; no second create was attempted',
        true,
      );
    }

    let createError: unknown;
    try {
      await this.#request({
        provider: 'cloudflare',
        url: `${CLOUDFLARE_API}/accounts/${encoded(action.input.account_id)}/r2/buckets`,
        method: 'POST',
        body: {
          name: action.input.name,
          storageClass: action.input.storage_class,
        },
        headers: { 'cf-r2-jurisdiction': action.input.jurisdiction },
        acceptedStatuses: [200],
      });
    } catch (error) {
      createError = error;
    }

    const reconciled = await this.#lookupR2Bucket(action);
    if (reconciled) {
      return this.#r2BucketResource(action, reconciled);
    }
    if (createError instanceof ProviderHttpFailure && createError.ambiguousMutation) {
      throw adapterFailure(
        'cloudflare',
        'R2_CREATE_AMBIGUOUS',
        'R2 bucket creation is ambiguous; resume will reconcile without creating again',
        true,
      );
    }
    if (createError) {
      throw createError;
    }
    throw adapterFailure(
      'cloudflare',
      'R2_CREATE_AMBIGUOUS',
      'Cloudflare accepted R2 bucket creation but the bucket is not yet observable',
      true,
    );
  }

  async #lookupSentryProject(
    action: Extract<ProvisioningAction, { id: 'sentry.project' }>,
  ): Promise<z.infer<typeof sentryProjectSchema> | null> {
    const response = await this.#request({
      provider: 'sentry',
      url: `${sentryApi(action.input.region)}/projects/${encoded(action.input.organization_slug)}/${encoded(action.input.slug)}/`,
      acceptedStatuses: [200, 404],
    });
    if (response.status === 404) {
      return null;
    }
    return this.#json('sentry', response, sentryProjectSchema);
  }

  async #sentryClientKey(
    action: Extract<ProvisioningAction, { id: 'sentry.project' }>,
    project: z.infer<typeof sentryProjectSchema>,
  ): Promise<z.infer<typeof sentryClientKeySchema>> {
    const response = await this.#request({
      provider: 'sentry',
      url: withQuery(
        `${sentryApi(action.input.region)}/projects/${encoded(action.input.organization_slug)}/${encoded(action.input.slug)}/keys/`,
        { status: 'active' },
      ),
      acceptedStatuses: [200],
    });
    const keys = (await this.#json('sentry', response, sentryClientKeysSchema)).filter(
      (key) => key.isActive && key.projectId === project.id,
    );
    if (keys.length !== 1 || !keys[0]) {
      throw adapterFailure(
        'sentry',
        'CLIENT_KEY_CONFLICT',
        'Sentry project must expose exactly one active client key for deterministic binding',
      );
    }
    return keys[0];
  }

  async #sentryProjectResource(
    action: Extract<ProvisioningAction, { id: 'sentry.project' }>,
    project: z.infer<typeof sentryProjectSchema>,
  ): Promise<ProvisionedResource> {
    if (
      project.slug !== action.input.slug ||
      project.name !== action.input.name ||
      project.platform !== action.input.platform ||
      (project.status !== undefined && project.status !== 'active') ||
      !project.teams.some((team) => team.slug === action.input.team_slug)
    ) {
      throw adapterFailure(
        'sentry',
        'PROJECT_CONFLICT',
        'Existing Sentry project does not match the requested name, platform, team or status',
      );
    }
    const clientKey = await this.#sentryClientKey(action, project);
    return {
      provider: 'sentry',
      resource_kind: 'project',
      resource_id: project.id,
      display_name: project.slug,
      organization_slug: action.input.organization_slug,
      team_slug: action.input.team_slug,
      region: action.input.region,
      platform: action.input.platform,
      client_key_id: clientKey.id,
      dsn_sha256: sha256(clientKey.dsn.public),
    };
  }

  async #ensureSentryProject(
    action: Extract<ProvisioningAction, { id: 'sentry.project' }>,
    context: ProvisioningExecutionContext,
  ): Promise<ProvisionedResource> {
    const existing = await this.#lookupSentryProject(action);
    if (existing) {
      return this.#sentryProjectResource(action, existing);
    }
    if (context.previousError?.code === 'SENTRY_PROJECT_CREATE_AMBIGUOUS') {
      throw adapterFailure(
        'sentry',
        'PROJECT_CREATE_AMBIGUOUS',
        'Sentry project creation remains ambiguous; no second create was attempted',
        true,
      );
    }

    let createError: unknown;
    try {
      await this.#request({
        provider: 'sentry',
        url: `${sentryApi(action.input.region)}/teams/${encoded(action.input.organization_slug)}/${encoded(action.input.team_slug)}/projects/`,
        method: 'POST',
        body: {
          name: action.input.name,
          slug: action.input.slug,
          platform: action.input.platform,
          default_rules: action.input.default_rules,
        },
        acceptedStatuses: [201],
      });
    } catch (error) {
      createError = error;
    }

    const reconciled = await this.#lookupSentryProject(action);
    if (reconciled) {
      return this.#sentryProjectResource(action, reconciled);
    }
    if (createError instanceof ProviderHttpFailure && createError.ambiguousMutation) {
      throw adapterFailure(
        'sentry',
        'PROJECT_CREATE_AMBIGUOUS',
        'Sentry project creation is ambiguous; resume will reconcile without creating again',
        true,
      );
    }
    if (createError) {
      throw createError;
    }
    throw adapterFailure(
      'sentry',
      'PROJECT_CREATE_AMBIGUOUS',
      'Sentry accepted project creation but the project is not yet observable',
      true,
    );
  }

  async #lookupPosthogProject(
    action: Extract<ProvisioningAction, { id: 'posthog.project' }>,
  ): Promise<z.infer<typeof posthogProjectSchema> | null> {
    const projects: z.infer<typeof posthogProjectSchema>[] = [];
    const limit = 100;
    let offset = 0;
    let count = 0;
    do {
      const response = await this.#request({
        provider: 'posthog',
        url: withQuery(
          `${POSTHOG_API}/organizations/${encoded(action.input.organization_id)}/projects/`,
          { search: action.input.name, limit: String(limit), offset: String(offset) },
        ),
        acceptedStatuses: [200],
      });
      const page = await this.#json('posthog', response, posthogProjectsSchema);
      projects.push(
        ...page.results.filter(
          (project) =>
            project.name === action.input.name &&
            project.organization === action.input.organization_id,
        ),
      );
      count = page.count;
      offset += page.results.length;
      if (page.results.length === 0) {
        break;
      }
    } while (offset < count);

    if (projects.length > 1) {
      throw adapterFailure(
        'posthog',
        'PROJECT_CONFLICT',
        'PostHog organization contains multiple projects with the requested exact name',
      );
    }
    return projects[0] ?? null;
  }

  #posthogProjectResource(
    action: Extract<ProvisioningAction, { id: 'posthog.project' }>,
    project: z.infer<typeof posthogProjectSchema>,
  ): ProvisionedResource {
    if (
      project.name !== action.input.name ||
      project.organization !== action.input.organization_id
    ) {
      throw adapterFailure(
        'posthog',
        'PROJECT_CONFLICT',
        'Existing PostHog project does not match the requested name or organization',
      );
    }
    return {
      provider: 'posthog',
      resource_kind: 'project',
      resource_id: project.id,
      display_name: project.name,
      organization_id: project.organization,
      region: action.input.region,
      project_api_key_sha256: sha256(project.api_token),
    };
  }

  async #ensurePosthogProject(
    action: Extract<ProvisioningAction, { id: 'posthog.project' }>,
    context: ProvisioningExecutionContext,
  ): Promise<ProvisionedResource> {
    const existing = await this.#lookupPosthogProject(action);
    if (existing) {
      return this.#posthogProjectResource(action, existing);
    }
    if (context.previousError?.code === 'POSTHOG_PROJECT_CREATE_AMBIGUOUS') {
      throw adapterFailure(
        'posthog',
        'PROJECT_CREATE_AMBIGUOUS',
        'PostHog project creation remains ambiguous; no second create was attempted',
        true,
      );
    }

    let createError: unknown;
    try {
      await this.#request({
        provider: 'posthog',
        url: `${POSTHOG_API}/organizations/${encoded(action.input.organization_id)}/projects/`,
        method: 'POST',
        body: { name: action.input.name },
        acceptedStatuses: [201],
      });
    } catch (error) {
      createError = error;
    }

    const reconciled = await this.#lookupPosthogProject(action);
    if (reconciled) {
      return this.#posthogProjectResource(action, reconciled);
    }
    if (createError instanceof ProviderHttpFailure && createError.ambiguousMutation) {
      throw adapterFailure(
        'posthog',
        'PROJECT_CREATE_AMBIGUOUS',
        'PostHog project creation is ambiguous; resume will reconcile without creating again',
        true,
      );
    }
    if (createError) {
      throw createError;
    }
    throw adapterFailure(
      'posthog',
      'PROJECT_CREATE_AMBIGUOUS',
      'PostHog accepted project creation but the project is not yet observable',
      true,
    );
  }

  async #lookupDatabaseBinding(
    action: Extract<ProvisioningAction, { id: 'vercel.database-binding' }>,
    project: Extract<ProvisionedResource, { provider: 'vercel'; resource_kind: 'project' }>,
  ): Promise<ProvisionedResource | null> {
    const projectAction = action.input.project_action_id;
    if (projectAction !== 'vercel.project') {
      throw new Error('Database binding references an unexpected Vercel action');
    }

    const teamId = this.#currentVercelTeamId;
    if (!teamId) {
      throw new Error('Vercel team preflight was not completed');
    }
    const response = await this.#request({
      provider: 'vercel',
      url: withQuery(`${VERCEL_API}/v9/projects/${encoded(project.resource_id)}/env`, {
        teamId,
      }),
      acceptedStatuses: [200],
    });
    const environmentVariables = (
      await this.#json('vercel', response, vercelEnvironmentVariablesSchema)
    ).envs;
    const databaseVariables = environmentVariables.filter(
      (variable) => variable.key === action.input.environment_variable,
    );
    const markers = environmentVariables.filter(
      (variable) => variable.key === DATABASE_BINDING_MARKER,
    );
    if (databaseVariables.length === 0 && markers.length === 0) {
      return null;
    }
    const sensitiveDatabase = databaseVariables.find(
      (variable) =>
        variable.type === 'sensitive' &&
        hasExactTargets(variable.target, DATABASE_SENSITIVE_TARGETS),
    );
    const developmentDatabase = databaseVariables.find(
      (variable) =>
        variable.type === 'encrypted' &&
        hasExactTargets(variable.target, DATABASE_DEVELOPMENT_TARGETS),
    );
    const marker = markers[0];
    if (
      databaseVariables.length !== 2 ||
      !sensitiveDatabase ||
      !developmentDatabase ||
      markers.length !== 1 ||
      !marker ||
      marker.type !== 'plain' ||
      marker.value !== action.idempotency_key ||
      !hasExactTargets(marker.target, DATABASE_MARKER_TARGETS)
    ) {
      throw adapterFailure(
        'vercel',
        'BINDING_CONFLICT',
        'Existing Vercel database environment variables are not owned by this plan',
      );
    }
    return {
      provider: 'vercel',
      resource_kind: 'database-binding',
      resource_id: marker.id,
      display_name: action.input.environment_variable,
    };
  }

  #currentVercelTeamId: string | null = null;

  async #connectionUri(
    project: Extract<ProvisionedResource, { provider: 'neon' }>,
  ): Promise<string> {
    const response = await this.#request({
      provider: 'neon',
      url: withQuery(`${NEON_API}/projects/${encoded(project.resource_id)}/connection_uri`, {
        database_name: project.database_name,
        role_name: project.role_name,
        pooled: 'true',
      }),
      acceptedStatuses: [200],
    });
    return this.#json('neon', response, neonConnectionUriSchema);
  }

  async #ensureDatabaseBinding(
    action: Extract<ProvisioningAction, { id: 'vercel.database-binding' }>,
    context: ProvisioningExecutionContext,
  ): Promise<ProvisionedResource> {
    const project = requireDependency(context, 'vercel.project');
    const database = requireDependency(context, 'neon.project');
    if (project.provider !== 'vercel' || project.resource_kind !== 'project') {
      throw new Error('Database binding dependency is not a Vercel project');
    }
    if (database.provider !== 'neon') {
      throw new Error('Database binding dependency is not a Neon project');
    }

    const existing = await this.#lookupDatabaseBinding(action, project);
    if (existing) {
      return existing;
    }
    if (context.previousError?.code === 'VERCEL_BINDING_CREATE_AMBIGUOUS') {
      throw adapterFailure(
        'vercel',
        'BINDING_CREATE_AMBIGUOUS',
        'Vercel database binding creation remains ambiguous; no second create was attempted',
        true,
      );
    }

    const connectionUri = await this.#connectionUri(database);
    const teamId = this.#currentVercelTeamId;
    if (!teamId) {
      throw new Error('Vercel team preflight was not completed');
    }
    let createError: unknown;
    try {
      await this.#request({
        provider: 'vercel',
        url: withQuery(`${VERCEL_API}/v10/projects/${encoded(project.resource_id)}/env`, {
          teamId,
        }),
        method: 'POST',
        body: [
          {
            key: action.input.environment_variable,
            value: connectionUri,
            type: 'sensitive',
            target: [...DATABASE_SENSITIVE_TARGETS],
          },
          {
            key: action.input.environment_variable,
            value: connectionUri,
            type: 'encrypted',
            target: [...DATABASE_DEVELOPMENT_TARGETS],
          },
          {
            key: DATABASE_BINDING_MARKER,
            value: action.idempotency_key,
            type: 'plain',
            target: [...DATABASE_MARKER_TARGETS],
          },
        ],
        acceptedStatuses: [200, 201],
      });
    } catch (error) {
      createError = error;
    }

    const reconciled = await this.#lookupDatabaseBinding(action, project);
    if (reconciled) {
      return reconciled;
    }
    if (createError instanceof ProviderHttpFailure && createError.ambiguousMutation) {
      throw adapterFailure(
        'vercel',
        'BINDING_CREATE_AMBIGUOUS',
        'Vercel database binding creation is ambiguous; resume will only reconcile',
        true,
      );
    }
    if (createError) {
      throw createError;
    }
    throw adapterFailure(
      'vercel',
      'BINDING_CREATE_AMBIGUOUS',
      'Vercel accepted the binding but its ownership marker is not yet observable',
      true,
    );
  }

  async #lookupR2Binding(
    action: Extract<ProvisioningAction, { id: 'vercel.r2-binding' }>,
    project: Extract<ProvisionedResource, { provider: 'vercel'; resource_kind: 'project' }>,
  ): Promise<ProvisionedResource | null> {
    const teamId = this.#currentVercelTeamId;
    if (!teamId) {
      throw new Error('Vercel team preflight was not completed');
    }
    const response = await this.#request({
      provider: 'vercel',
      url: withQuery(`${VERCEL_API}/v9/projects/${encoded(project.resource_id)}/env`, {
        teamId,
      }),
      acceptedStatuses: [200],
    });
    const environment = (await this.#json('vercel', response, vercelEnvironmentVariablesSchema))
      .envs;
    const managedKeys = new Set<string>([...R2_BINDING_KEYS, R2_BINDING_MARKER]);
    const managed = environment.filter((variable) => managedKeys.has(variable.key));
    if (managed.length === 0) {
      return null;
    }

    const nonSecretBindingsMatch = R2_NON_SECRET_KEYS.every((key) => {
      const variables = managed.filter((variable) => variable.key === key);
      return (
        variables.length === 1 &&
        variables[0]?.type === 'encrypted' &&
        hasExactTargets(variables[0].target, DATABASE_MARKER_TARGETS)
      );
    });
    const secretBindingsMatch = R2_SECRET_KEYS.every((key) => {
      const variables = managed.filter((variable) => variable.key === key);
      return (
        variables.length === 2 &&
        variables.some(
          (variable) =>
            variable.type === 'sensitive' &&
            hasExactTargets(variable.target, DATABASE_SENSITIVE_TARGETS),
        ) &&
        variables.some(
          (variable) =>
            variable.type === 'encrypted' &&
            hasExactTargets(variable.target, DATABASE_DEVELOPMENT_TARGETS),
        )
      );
    });
    const markers = managed.filter((variable) => variable.key === R2_BINDING_MARKER);
    const marker = markers[0];
    if (
      managed.length !== 8 ||
      !nonSecretBindingsMatch ||
      !secretBindingsMatch ||
      markers.length !== 1 ||
      !marker ||
      marker.type !== 'plain' ||
      marker.value !== action.idempotency_key ||
      !hasExactTargets(marker.target, DATABASE_MARKER_TARGETS)
    ) {
      throw adapterFailure(
        'vercel',
        'R2_BINDING_CONFLICT',
        'Existing Vercel R2 variables are not owned by this plan',
      );
    }
    return {
      provider: 'vercel',
      resource_kind: 'r2-binding',
      resource_id: marker.id,
      display_name: 'Cloudflare R2 runtime binding',
      bound_keys: action.input.bindings,
    };
  }

  async #ensureR2Binding(
    action: Extract<ProvisioningAction, { id: 'vercel.r2-binding' }>,
    context: ProvisioningExecutionContext,
  ): Promise<ProvisionedResource> {
    const project = requireDependency(context, 'vercel.project');
    const bucket = requireDependency(context, 'cloudflare.r2-bucket');
    if (project.provider !== 'vercel' || project.resource_kind !== 'project') {
      throw new Error('R2 binding dependency is not a Vercel project');
    }
    if (bucket.provider !== 'cloudflare' || bucket.resource_kind !== 'r2-bucket') {
      throw new Error('R2 binding dependency is not a Cloudflare R2 bucket');
    }

    const existing = await this.#lookupR2Binding(action, project);
    if (existing) {
      return existing;
    }
    if (context.previousError?.code === 'VERCEL_R2_BINDING_CREATE_AMBIGUOUS') {
      throw adapterFailure(
        'vercel',
        'R2_BINDING_CREATE_AMBIGUOUS',
        'Vercel R2 binding creation remains ambiguous; no second create was attempted',
        true,
      );
    }

    const accessKeyId = this.#credentials.r2AccessKeyId;
    const secretAccessKey = this.#credentials.r2SecretAccessKey;
    if (!accessKeyId || !secretAccessKey) {
      throw adapterFailure(
        'cloudflare',
        'R2_RUNTIME_CREDENTIAL_MISSING',
        'R2 runtime credentials are missing; create a bucket-scoped Object Read & Write token and resume',
        true,
      );
    }
    const values: Record<(typeof R2_BINDING_KEYS)[number], string> = {
      CLOUDFLARE_ACCOUNT_ID: bucket.account_id,
      R2_ACCESS_KEY_ID: accessKeyId,
      R2_BUCKET_NAME: bucket.display_name,
      R2_ENDPOINT: `https://${bucket.account_id}.eu.r2.cloudflarestorage.com`,
      R2_SECRET_ACCESS_KEY: secretAccessKey,
    };
    const variables = R2_BINDING_KEYS.flatMap((key) =>
      R2_SECRET_KEYS.includes(key as (typeof R2_SECRET_KEYS)[number])
        ? [
            {
              key,
              value: values[key],
              type: 'sensitive',
              target: [...DATABASE_SENSITIVE_TARGETS],
            },
            {
              key,
              value: values[key],
              type: 'encrypted',
              target: [...DATABASE_DEVELOPMENT_TARGETS],
            },
          ]
        : [
            {
              key,
              value: values[key],
              type: 'encrypted',
              target: [...DATABASE_MARKER_TARGETS],
            },
          ],
    );
    const teamId = this.#currentVercelTeamId;
    if (!teamId) {
      throw new Error('Vercel team preflight was not completed');
    }
    let createError: unknown;
    try {
      await this.#request({
        provider: 'vercel',
        url: withQuery(`${VERCEL_API}/v10/projects/${encoded(project.resource_id)}/env`, {
          teamId,
        }),
        method: 'POST',
        body: [
          ...variables,
          {
            key: R2_BINDING_MARKER,
            value: action.idempotency_key,
            type: 'plain',
            target: [...DATABASE_MARKER_TARGETS],
          },
        ],
        acceptedStatuses: [200, 201],
      });
    } catch (error) {
      createError = error;
    }

    const reconciled = await this.#lookupR2Binding(action, project);
    if (reconciled) {
      return reconciled;
    }
    if (createError instanceof ProviderHttpFailure && createError.ambiguousMutation) {
      throw adapterFailure(
        'vercel',
        'R2_BINDING_CREATE_AMBIGUOUS',
        'Vercel R2 binding creation is ambiguous; resume will only reconcile',
        true,
      );
    }
    if (createError) {
      throw createError;
    }
    throw adapterFailure(
      'vercel',
      'R2_BINDING_CREATE_AMBIGUOUS',
      'Vercel accepted the R2 binding but its ownership marker is not yet observable',
      true,
    );
  }

  async #lookupSentryBinding(
    action: Extract<ProvisioningAction, { id: 'vercel.sentry-binding' }>,
    project: Extract<ProvisionedResource, { provider: 'vercel'; resource_kind: 'project' }>,
  ): Promise<ProvisionedResource | null> {
    const teamId = this.#currentVercelTeamId;
    if (!teamId) {
      throw new Error('Vercel team preflight was not completed');
    }
    const response = await this.#request({
      provider: 'vercel',
      url: withQuery(`${VERCEL_API}/v9/projects/${encoded(project.resource_id)}/env`, {
        teamId,
      }),
      acceptedStatuses: [200],
    });
    const environment = (await this.#json('vercel', response, vercelEnvironmentVariablesSchema))
      .envs;
    const managedKeys = new Set<string>([...SENTRY_BINDING_KEYS, SENTRY_BINDING_MARKER]);
    const managed = environment.filter((variable) => managedKeys.has(variable.key));
    if (managed.length === 0) {
      return null;
    }

    const nonSecretBindingsMatch = SENTRY_NON_SECRET_KEYS.every((key) => {
      const variables = managed.filter((variable) => variable.key === key);
      return (
        variables.length === 1 &&
        variables[0]?.type === 'encrypted' &&
        hasExactTargets(variables[0].target, DATABASE_MARKER_TARGETS)
      );
    });
    const secretBindingsMatch = SENTRY_SECRET_KEYS.every((key) => {
      const variables = managed.filter((variable) => variable.key === key);
      return (
        variables.length === 2 &&
        variables.some(
          (variable) =>
            variable.type === 'sensitive' &&
            hasExactTargets(variable.target, DATABASE_SENSITIVE_TARGETS),
        ) &&
        variables.some(
          (variable) =>
            variable.type === 'encrypted' &&
            hasExactTargets(variable.target, DATABASE_DEVELOPMENT_TARGETS),
        )
      );
    });
    const markers = managed.filter((variable) => variable.key === SENTRY_BINDING_MARKER);
    const marker = markers[0];
    if (
      managed.length !== 7 ||
      !nonSecretBindingsMatch ||
      !secretBindingsMatch ||
      markers.length !== 1 ||
      !marker ||
      marker.type !== 'plain' ||
      marker.value !== action.idempotency_key ||
      !hasExactTargets(marker.target, DATABASE_MARKER_TARGETS)
    ) {
      throw adapterFailure(
        'vercel',
        'SENTRY_BINDING_CONFLICT',
        'Existing Vercel Sentry variables are not owned by this plan',
      );
    }
    return {
      provider: 'vercel',
      resource_kind: 'sentry-binding',
      resource_id: marker.id,
      display_name: 'Sentry runtime binding',
      bound_keys: action.input.bindings,
    };
  }

  async #sentryPublicDsn(
    project: Extract<ProvisionedResource, { provider: 'sentry'; resource_kind: 'project' }>,
  ): Promise<string> {
    const response = await this.#request({
      provider: 'sentry',
      url: withQuery(
        `${sentryApi(project.region)}/projects/${encoded(project.organization_slug)}/${encoded(project.display_name)}/keys/`,
        { status: 'active' },
      ),
      acceptedStatuses: [200],
    });
    const keys = await this.#json('sentry', response, sentryClientKeysSchema);
    const key = keys.find(
      (candidate) =>
        candidate.id === project.client_key_id &&
        candidate.projectId === project.resource_id &&
        candidate.isActive,
    );
    if (!key || sha256(key.dsn.public) !== project.dsn_sha256) {
      throw adapterFailure(
        'sentry',
        'CLIENT_KEY_CONFLICT',
        'Sentry client key changed after project provisioning',
      );
    }
    return key.dsn.public;
  }

  async #ensureSentryBinding(
    action: Extract<ProvisioningAction, { id: 'vercel.sentry-binding' }>,
    context: ProvisioningExecutionContext,
  ): Promise<ProvisionedResource> {
    const project = requireDependency(context, 'vercel.project');
    const sentryProject = requireDependency(context, 'sentry.project');
    if (project.provider !== 'vercel' || project.resource_kind !== 'project') {
      throw new Error('Sentry binding dependency is not a Vercel project');
    }
    if (sentryProject.provider !== 'sentry' || sentryProject.resource_kind !== 'project') {
      throw new Error('Sentry binding dependency is not a Sentry project');
    }

    const existing = await this.#lookupSentryBinding(action, project);
    if (existing) {
      return existing;
    }
    if (context.previousError?.code === 'VERCEL_SENTRY_BINDING_CREATE_AMBIGUOUS') {
      throw adapterFailure(
        'vercel',
        'SENTRY_BINDING_CREATE_AMBIGUOUS',
        'Vercel Sentry binding creation remains ambiguous; no second create was attempted',
        true,
      );
    }

    const buildAuthToken = this.#credentials.sentryBuildAuthToken;
    if (!buildAuthToken) {
      throw adapterFailure(
        'sentry',
        'BUILD_AUTH_TOKEN_MISSING',
        'Sentry build token is missing; create a release-upload token and resume',
        true,
      );
    }
    const dsn = await this.#sentryPublicDsn(sentryProject);
    const values: Record<(typeof SENTRY_BINDING_KEYS)[number], string> = {
      SENTRY_DSN: dsn,
      NEXT_PUBLIC_SENTRY_DSN: dsn,
      SENTRY_AUTH_TOKEN: buildAuthToken,
      SENTRY_ORG: sentryProject.organization_slug,
      SENTRY_PROJECT: sentryProject.display_name,
    };
    const variables = SENTRY_BINDING_KEYS.flatMap((key) =>
      SENTRY_SECRET_KEYS.includes(key as (typeof SENTRY_SECRET_KEYS)[number])
        ? [
            {
              key,
              value: values[key],
              type: 'sensitive',
              target: [...DATABASE_SENSITIVE_TARGETS],
            },
            {
              key,
              value: values[key],
              type: 'encrypted',
              target: [...DATABASE_DEVELOPMENT_TARGETS],
            },
          ]
        : [
            {
              key,
              value: values[key],
              type: 'encrypted',
              target: [...DATABASE_MARKER_TARGETS],
            },
          ],
    );
    const teamId = this.#currentVercelTeamId;
    if (!teamId) {
      throw new Error('Vercel team preflight was not completed');
    }
    let createError: unknown;
    try {
      await this.#request({
        provider: 'vercel',
        url: withQuery(`${VERCEL_API}/v10/projects/${encoded(project.resource_id)}/env`, {
          teamId,
        }),
        method: 'POST',
        body: [
          ...variables,
          {
            key: SENTRY_BINDING_MARKER,
            value: action.idempotency_key,
            type: 'plain',
            target: [...DATABASE_MARKER_TARGETS],
          },
        ],
        acceptedStatuses: [200, 201],
      });
    } catch (error) {
      createError = error;
    }

    const reconciled = await this.#lookupSentryBinding(action, project);
    if (reconciled) {
      return reconciled;
    }
    if (createError instanceof ProviderHttpFailure && createError.ambiguousMutation) {
      throw adapterFailure(
        'vercel',
        'SENTRY_BINDING_CREATE_AMBIGUOUS',
        'Vercel Sentry binding creation is ambiguous; resume will only reconcile',
        true,
      );
    }
    if (createError) {
      throw createError;
    }
    throw adapterFailure(
      'vercel',
      'SENTRY_BINDING_CREATE_AMBIGUOUS',
      'Vercel accepted the Sentry binding but its ownership marker is not yet observable',
      true,
    );
  }

  async #lookupPosthogBinding(
    action: Extract<ProvisioningAction, { id: 'vercel.posthog-binding' }>,
    project: Extract<ProvisionedResource, { provider: 'vercel'; resource_kind: 'project' }>,
  ): Promise<ProvisionedResource | null> {
    const teamId = this.#currentVercelTeamId;
    if (!teamId) {
      throw new Error('Vercel team preflight was not completed');
    }
    const response = await this.#request({
      provider: 'vercel',
      url: withQuery(`${VERCEL_API}/v9/projects/${encoded(project.resource_id)}/env`, {
        teamId,
      }),
      acceptedStatuses: [200],
    });
    const environment = (await this.#json('vercel', response, vercelEnvironmentVariablesSchema))
      .envs;
    const managedKeys = new Set<string>([...POSTHOG_BINDING_KEYS, POSTHOG_BINDING_MARKER]);
    const managed = environment.filter((variable) => managedKeys.has(variable.key));
    if (managed.length === 0) {
      return null;
    }

    const bindingsMatch = POSTHOG_BINDING_KEYS.every((key) => {
      const variables = managed.filter((variable) => variable.key === key);
      return (
        variables.length === 1 &&
        variables[0]?.type === 'encrypted' &&
        hasExactTargets(variables[0].target, DATABASE_MARKER_TARGETS)
      );
    });
    const markers = managed.filter((variable) => variable.key === POSTHOG_BINDING_MARKER);
    const marker = markers[0];
    if (
      managed.length !== 3 ||
      !bindingsMatch ||
      markers.length !== 1 ||
      !marker ||
      marker.type !== 'plain' ||
      marker.value !== action.idempotency_key ||
      !hasExactTargets(marker.target, DATABASE_MARKER_TARGETS)
    ) {
      throw adapterFailure(
        'vercel',
        'POSTHOG_BINDING_CONFLICT',
        'Existing Vercel PostHog variables are not owned by this plan',
      );
    }
    return {
      provider: 'vercel',
      resource_kind: 'posthog-binding',
      resource_id: marker.id,
      display_name: 'PostHog runtime binding',
      bound_keys: action.input.bindings,
    };
  }

  async #posthogProjectApiKey(
    project: Extract<ProvisionedResource, { provider: 'posthog'; resource_kind: 'project' }>,
  ): Promise<string> {
    const response = await this.#request({
      provider: 'posthog',
      url: `${POSTHOG_API}/organizations/${encoded(project.organization_id)}/projects/${encoded(project.resource_id)}/`,
      acceptedStatuses: [200],
    });
    const current = await this.#json('posthog', response, posthogProjectSchema);
    if (
      current.id !== project.resource_id ||
      current.name !== project.display_name ||
      current.organization !== project.organization_id ||
      sha256(current.api_token) !== project.project_api_key_sha256
    ) {
      throw adapterFailure(
        'posthog',
        'PROJECT_KEY_CONFLICT',
        'PostHog project key changed after project provisioning',
      );
    }
    return current.api_token;
  }

  async #ensurePosthogBinding(
    action: Extract<ProvisioningAction, { id: 'vercel.posthog-binding' }>,
    context: ProvisioningExecutionContext,
  ): Promise<ProvisionedResource> {
    const project = requireDependency(context, 'vercel.project');
    const posthogProject = requireDependency(context, 'posthog.project');
    if (project.provider !== 'vercel' || project.resource_kind !== 'project') {
      throw new Error('PostHog binding dependency is not a Vercel project');
    }
    if (posthogProject.provider !== 'posthog' || posthogProject.resource_kind !== 'project') {
      throw new Error('PostHog binding dependency is not a PostHog project');
    }

    const existing = await this.#lookupPosthogBinding(action, project);
    if (existing) {
      return existing;
    }
    if (context.previousError?.code === 'VERCEL_POSTHOG_BINDING_CREATE_AMBIGUOUS') {
      throw adapterFailure(
        'vercel',
        'POSTHOG_BINDING_CREATE_AMBIGUOUS',
        'Vercel PostHog binding creation remains ambiguous; no second create was attempted',
        true,
      );
    }

    const values: Record<(typeof POSTHOG_BINDING_KEYS)[number], string> = {
      NEXT_PUBLIC_POSTHOG_KEY: await this.#posthogProjectApiKey(posthogProject),
      NEXT_PUBLIC_POSTHOG_HOST: '/ingest',
    };
    const variables = POSTHOG_BINDING_KEYS.map((key) => ({
      key,
      value: values[key],
      type: 'encrypted',
      target: [...DATABASE_MARKER_TARGETS],
    }));
    const teamId = this.#currentVercelTeamId;
    if (!teamId) {
      throw new Error('Vercel team preflight was not completed');
    }
    let createError: unknown;
    try {
      await this.#request({
        provider: 'vercel',
        url: withQuery(`${VERCEL_API}/v10/projects/${encoded(project.resource_id)}/env`, {
          teamId,
        }),
        method: 'POST',
        body: [
          ...variables,
          {
            key: POSTHOG_BINDING_MARKER,
            value: action.idempotency_key,
            type: 'plain',
            target: [...DATABASE_MARKER_TARGETS],
          },
        ],
        acceptedStatuses: [200, 201],
      });
    } catch (error) {
      createError = error;
    }

    const reconciled = await this.#lookupPosthogBinding(action, project);
    if (reconciled) {
      return reconciled;
    }
    if (createError instanceof ProviderHttpFailure && createError.ambiguousMutation) {
      throw adapterFailure(
        'vercel',
        'POSTHOG_BINDING_CREATE_AMBIGUOUS',
        'Vercel PostHog binding creation is ambiguous; resume will only reconcile',
        true,
      );
    }
    if (createError) {
      throw createError;
    }
    throw adapterFailure(
      'vercel',
      'POSTHOG_BINDING_CREATE_AMBIGUOUS',
      'Vercel accepted the PostHog binding but its ownership marker is not yet observable',
      true,
    );
  }
}
