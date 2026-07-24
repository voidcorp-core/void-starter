import { z } from 'zod';
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
const DATABASE_BINDING_MARKER = 'VOID_STARTER_DATABASE_BINDING_ID';
const DATABASE_SENSITIVE_TARGETS = ['preview', 'production'] as const;
const DATABASE_DEVELOPMENT_TARGETS = ['development'] as const;
const DATABASE_MARKER_TARGETS = ['development', 'preview', 'production'] as const;

type Provider = 'github' | 'vercel' | 'neon';
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type LiveProvisioningCredentials = {
  githubToken: string;
  vercelToken?: string;
  neonApiKey?: string;
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
  state: z.literal('active'),
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

function requiredCredential(
  environment: Record<string, string | undefined>,
  name: 'GITHUB_TOKEN' | 'VERCEL_TOKEN' | 'NEON_API_KEY',
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
  return {
    githubToken: requiredCredential(environment, 'GITHUB_TOKEN'),
    ...(usesVercel ? { vercelToken: requiredCredential(environment, 'VERCEL_TOKEN') } : {}),
    ...(usesNeon ? { neonApiKey: requiredCredential(environment, 'NEON_API_KEY') } : {}),
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
    method?: 'GET' | 'POST';
    body?: unknown;
    acceptedStatuses: number[];
  }): Promise<Response> {
    const method = input.method ?? 'GET';
    const token =
      input.provider === 'github'
        ? this.#credentials.githubToken
        : input.provider === 'vercel'
          ? this.#credentials.vercelToken
          : this.#credentials.neonApiKey;
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
    };
    if (input.provider === 'github') {
      headers['X-GitHub-Api-Version'] = '2026-03-10';
    }
    if (input.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await this.#fetch(input.url, {
        method,
        headers,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
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

    await Promise.all([
      githubAction ? this.#preflightGithub(githubAction) : Promise.resolve(),
      vercelAction ? this.#preflightVercel(vercelAction) : Promise.resolve(),
      neonAction ? this.#preflightNeon(neonAction) : Promise.resolve(),
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
      acceptedStatuses: [200],
    });
    await this.#json('github', membershipResponse, githubMembershipSchema);
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
}
