import { z } from 'zod';

export const manifestSha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<'ManifestSha256'>();
export const provisioningPlanSha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<'ProvisioningPlanSha256'>();

// GitHub account names accept alphanumerics and single hyphens, cannot begin or end
// with a hyphen, and are limited to 39 characters.
// Ref: https://docs.github.com/en/enterprise-cloud@latest/admin/managing-iam/iam-configuration-reference/username-considerations-for-external-authentication
const githubOwnerSchema = z
  .string()
  .trim()
  .max(39)
  .regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/)
  .brand<'GitHubOwner'>();

// Vercel's public tool contract identifies team IDs with the `team_` prefix.
// Ref: https://vercel.com/docs/agent-resources/vercel-mcp/tools
const vercelTeamIdSchema = z
  .string()
  .trim()
  .regex(/^team_[A-Za-z0-9]+$/)
  .brand<'VercelTeamId'>();
const handoffProjectNameSchema = z
  .string()
  .trim()
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .brand<'ProjectName'>();

const githubContextSchema = z.strictObject({
  owner: githubOwnerSchema,
  owner_kind: z.enum(['organization', 'user']),
  visibility: z.enum(['private', 'public']),
});
const vercelContextSchema = z.strictObject({
  team_id: vercelTeamIdSchema,
  region: z.literal('fra1'),
});
const neonContextSchema = z.strictObject({
  org_id: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,60}$/),
  region_id: z.literal('aws-eu-central-1'),
});
const browserOriginSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    );
  }, 'A browser origin is a scheme and a host, with no path, query or fragment')
  .transform((value) => new URL(value).origin);
const cloudflareContextSchema = z.strictObject({
  account_id: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{32}$/),
  browser_origins: z.array(browserOriginSchema).min(1).max(5).optional(),
});
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const sentryContextSchema = z.strictObject({
  organization_slug: slugSchema,
  team_slug: slugSchema,
  region: z.literal('de'),
});
const posthogContextSchema = z.strictObject({
  organization_id: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/),
  region: z.literal('eu'),
});
const dnsNameSchema = z
  .string()
  .trim()
  .min(4)
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  );
const cloudflareDnsContextSchema = z
  .strictObject({
    provider: z.literal('cloudflare'),
    account_id: z.string().regex(/^[a-f0-9]{32}$/),
    zone_id: z.string().regex(/^[a-f0-9]{32}$/),
    zone_name: dnsNameSchema,
    hostname: dnsNameSchema,
  })
  .superRefine((dns, context) => {
    if (dns.hostname === dns.zone_name || !dns.hostname.endsWith(`.${dns.zone_name}`)) {
      context.addIssue({
        code: 'custom',
        path: ['hostname'],
        message: 'DNS hostname must be a strict subdomain of the selected zone',
      });
    }
  });

export const provisioningHandoffContextSchema = z
  .strictObject({
    schema_version: z.literal(1),
    github: githubContextSchema,
    vercel: vercelContextSchema.optional(),
    neon: neonContextSchema.optional(),
    cloudflare: cloudflareContextSchema.optional(),
    sentry: sentryContextSchema.optional(),
    posthog: posthogContextSchema.optional(),
    dns: cloudflareDnsContextSchema.optional(),
  })
  .superRefine((context, refinement) => {
    if (
      context.cloudflare &&
      context.dns &&
      context.cloudflare.account_id !== context.dns.account_id
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['dns', 'account_id'],
        message: 'DNS and R2 must target the same explicit Cloudflare account',
      });
    }
  });

const recommendedExecutionSchema = z.tuple([
  z.literal('official-cli'),
  z.literal('provider-dashboard'),
  z.literal('external-iac'),
]);
const githubRecoverySchema = z.strictObject({
  inspection_required: z.literal(true),
  guidance: z.literal(
    'Inspect the owner and repository before retrying to avoid duplicate resources.',
  ),
});
const vercelRecoverySchema = z.strictObject({
  inspection_required: z.literal(true),
  guidance: z.literal(
    'Inspect the team project list before retrying to avoid duplicate resources.',
  ),
});

const githubRepositoryActionSchema = z.strictObject({
  id: z.literal('github.repository'),
  provider: z.literal('github'),
  resource_kind: z.literal('repository'),
  purpose: z.literal('Own the canonical source repository for the generated project'),
  depends_on: z.tuple([]),
  desired_state: z.strictObject({
    owner: githubOwnerSchema,
    owner_kind: z.enum(['organization', 'user']),
    name: handoffProjectNameSchema,
    visibility: z.enum(['private', 'public']),
  }),
  required_credentials: z.tuple([
    z.strictObject({
      name: z.literal('GITHUB_TOKEN'),
      purpose: z.literal('Authorize repository creation or configuration outside the Factory'),
    }),
  ]),
  recommended_execution: recommendedExecutionSchema,
  expected_outputs: z.tuple([
    z.strictObject({
      name: z.literal('repository_url'),
      purpose: z.literal('Canonical HTTPS URL of the configured repository'),
    }),
  ]),
  completion_criteria: z.tuple([
    z.literal('The repository exists under the requested owner with the requested visibility'),
  ]),
  recovery: githubRecoverySchema,
});

const vercelProjectActionSchema = z.strictObject({
  id: z.literal('vercel.project'),
  provider: z.literal('vercel'),
  resource_kind: z.literal('project'),
  purpose: z.literal('Host the selected Next.js web surface outside the Factory'),
  depends_on: z.tuple([z.literal('github.repository')]),
  desired_state: z.strictObject({
    team_id: vercelTeamIdSchema,
    name: handoffProjectNameSchema,
    framework: z.literal('nextjs'),
    region: z.literal('fra1'),
    root_directory: z.literal('apps/web'),
    repository_action_id: z.literal('github.repository'),
  }),
  required_credentials: z.tuple([
    z.strictObject({
      name: z.literal('VERCEL_TOKEN'),
      purpose: z.literal('Authorize project creation or configuration outside the Factory'),
    }),
  ]),
  recommended_execution: recommendedExecutionSchema,
  expected_outputs: z.tuple([
    z.strictObject({
      name: z.literal('project_id'),
      purpose: z.literal('Stable identifier of the configured Vercel project'),
    }),
    z.strictObject({
      name: z.literal('project_url'),
      purpose: z.literal('Canonical dashboard URL of the configured Vercel project'),
    }),
  ]),
  completion_criteria: z.tuple([
    z.literal('The Vercel project is linked to the repository and uses the requested root'),
  ]),
  recovery: vercelRecoverySchema,
});

export const provisioningHandoffActionSchema = z.discriminatedUnion('id', [
  githubRepositoryActionSchema,
  vercelProjectActionSchema,
]);

export const provisioningHandoffPlanSchema = z.strictObject({
  schema_version: z.literal(2),
  execution_owner: z.literal('external'),
  manifest_sha256: manifestSha256Schema,
  actions: z.union([
    z.tuple([githubRepositoryActionSchema]),
    z.tuple([githubRepositoryActionSchema, vercelProjectActionSchema]),
  ]),
});

export type ManifestSha256 = z.infer<typeof manifestSha256Schema>;
export type ProvisioningPlanSha256 = z.infer<typeof provisioningPlanSha256Schema>;
export type ProvisioningHandoffContext = z.infer<typeof provisioningHandoffContextSchema>;
export type ProvisioningHandoffAction = z.infer<typeof provisioningHandoffActionSchema>;
export type ProvisioningHandoffPlan = z.infer<typeof provisioningHandoffPlanSchema>;
