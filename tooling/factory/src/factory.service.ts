import type { BuildManifest, CompositionPlan, CompositionUnit } from './factory.types';
import { buildManifestSchema } from './factory.types';

export function parseBuildManifest(input: unknown): BuildManifest {
  return buildManifestSchema.parse(input);
}

export function createCompositionPlan(manifest: BuildManifest): CompositionPlan {
  const units: CompositionUnit[] = [];

  if (manifest.surfaces.web !== 'none') {
    units.push({ kind: 'surface', id: 'web', adapter: manifest.surfaces.web });
  }
  if (manifest.surfaces.mobile.adapter !== 'none') {
    units.push({ kind: 'surface', id: 'mobile', adapter: manifest.surfaces.mobile.adapter });
  }
  if (manifest.surfaces.worker !== 'none') {
    units.push({ kind: 'surface', id: 'worker', adapter: manifest.surfaces.worker });
  }

  if (manifest.workloads.http !== 'none') {
    units.push({ kind: 'workload', id: 'http', adapter: manifest.workloads.http });
  }
  if (manifest.workloads.durable_jobs !== 'none') {
    units.push({
      kind: 'workload',
      id: 'durable_jobs',
      adapter: manifest.workloads.durable_jobs,
    });
  }
  if (manifest.workloads.realtime_audio !== 'none') {
    units.push({
      kind: 'workload',
      id: 'realtime_audio',
      adapter: manifest.workloads.realtime_audio,
    });
  }
  if (manifest.workloads.persistent_service !== 'none') {
    units.push({
      kind: 'workload',
      id: 'persistent_service',
      adapter: manifest.workloads.persistent_service,
    });
  }

  if (manifest.data.database !== 'none') {
    units.push({ kind: 'capability', id: 'database', adapter: manifest.data.database });
  }
  if (manifest.data.orm !== 'none') {
    units.push({ kind: 'capability', id: 'orm', adapter: manifest.data.orm });
  }
  if (manifest.auth.provider !== 'none') {
    units.push({ kind: 'capability', id: 'auth', adapter: manifest.auth.provider });
  }
  if (manifest.data.files !== 'none') {
    units.push({ kind: 'capability', id: 'files', adapter: manifest.data.files });
  }

  if (manifest.operations.errors !== 'none') {
    units.push({ kind: 'capability', id: 'errors', adapter: manifest.operations.errors });
  }
  if (manifest.operations.analytics !== 'none') {
    units.push({
      kind: 'capability',
      id: 'analytics',
      adapter: manifest.operations.analytics,
    });
  }
  if (manifest.operations.email !== 'none') {
    units.push({ kind: 'capability', id: 'email', adapter: manifest.operations.email });
  }
  if (manifest.dns.provider !== 'none') {
    units.push({ kind: 'capability', id: 'dns', adapter: manifest.dns.provider });
  }

  return {
    schemaVersion: 1,
    project: manifest.project,
    units,
    policies: {
      authentication: {
        accessMode: manifest.auth.access_mode,
        passkeys: manifest.auth.passkeys,
        mfa: manifest.auth.mfa,
      },
      dataResidency: manifest.data_residency,
      cost: manifest.cost_policy,
    },
  };
}
