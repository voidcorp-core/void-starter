import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalManifest } from './__fixtures__/manifest.fixture';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson } from './integrity.service';
import { runLiveApplyCli, runLivePreflightCli } from './live-provisioning.cli';

const temporaryRoots: string[] = [];

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('live provisioning CLI', () => {
  it('runs a GET-only preflight and requires exact confirmation before live apply', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'void-starter-live-cli-test-'));
    temporaryRoots.push(projectRoot);
    await mkdir(join(projectRoot, '.void-starter'));
    await writeFile(
      join(projectRoot, '.void-starter/manifest.json'),
      serializeCanonicalJson(parseBuildManifest(canonicalManifest)),
      'utf8',
    );
    const contextPath = join(projectRoot, 'provisioning.yaml');
    await writeFile(
      contextPath,
      `schema_version: 1
github:
  owner: voidcorp-core
  owner_kind: organization
  visibility: private
vercel:
  team_id: team_example
  region: fra1
neon:
  org_id: org-example
  region_id: aws-eu-central-1
cloudflare:
  account_id: 0123456789abcdef0123456789abcdef
sentry:
  organization_slug: void-sandbox
  team_slug: platform
  region: de
`,
      'utf8',
    );

    const methods: string[] = [];
    const preflightFetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      methods.push(init?.method ?? 'GET');
      const url = new URL(input);
      if (url.pathname === '/user') {
        return jsonResponse({ login: 'factory-bot' });
      }
      if (url.pathname === '/user/memberships/orgs/voidcorp-core') {
        return jsonResponse({
          state: 'active',
          organization: {
            login: 'voidcorp-core',
          },
        });
      }
      if (url.pathname === '/v2/teams/team_example') {
        return jsonResponse({ id: 'team_example' });
      }
      if (url.pathname === '/api/v2/users/me/organizations') {
        return jsonResponse({ organizations: [{ id: 'org-example' }] });
      }
      if (url.pathname === '/client/v4/accounts/0123456789abcdef0123456789abcdef/r2/buckets') {
        return jsonResponse({ success: true, result: { buckets: [] } });
      }
      if (url.pathname === '/api/0/organizations/void-sandbox/') {
        return jsonResponse({
          slug: 'void-sandbox',
          status: { id: 'active' },
          links: { regionUrl: 'https://de.sentry.io' },
        });
      }
      if (url.pathname === '/api/0/teams/void-sandbox/platform/') {
        return jsonResponse({
          slug: 'platform',
          hasAccess: true,
          organization: { slug: 'void-sandbox' },
        });
      }
      throw new Error(`Unexpected preflight request: ${url.toString()}`);
    };
    const environment = {
      GITHUB_TOKEN: 'github-secret',
      VERCEL_TOKEN: 'vercel-secret',
      NEON_API_KEY: 'neon-secret',
      CLOUDFLARE_API_TOKEN: 'cloudflare-secret',
      SENTRY_API_TOKEN: 'sentry-secret',
      R2_ACCESS_KEY_ID: 'r2-access-key',
      R2_SECRET_ACCESS_KEY: 'r2-secret-key',
    };

    await expect(
      runLivePreflightCli({
        arguments: [projectRoot, contextPath],
        environment,
        fetch: preflightFetch,
      }),
    ).resolves.toMatchObject({
      ok: true,
      mode: 'live-preflight',
      providers: ['cloudflare', 'github', 'neon', 'sentry', 'vercel'],
    });
    expect(methods).toEqual(['GET', 'GET', 'GET', 'GET', 'GET', 'GET', 'GET']);
    await expect(
      readFile(join(projectRoot, '.void-starter/apply-state.json'), 'utf8'),
    ).rejects.toThrow();

    let liveFetchCalled = false;
    await expect(
      runLiveApplyCli({
        arguments: [projectRoot, contextPath, '--confirm-project', 'wrong-project'],
        environment,
        fetch: async () => {
          liveFetchCalled = true;
          return jsonResponse({});
        },
        requireExistingState: false,
      }),
    ).rejects.toThrow(/exactly match/);
    expect(liveFetchCalled).toBe(false);
  });
});
