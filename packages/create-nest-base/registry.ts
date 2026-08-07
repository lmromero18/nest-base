import { isAbsolute, resolve } from 'node:path';
import type {
  CapabilityDescriptor,
  ResolvedCapability,
  Source,
  SourceKind,
} from './types';

export const REGISTRY_REVISION = '2026-07-27';
export const DEFAULT_WIZARD_VERSION = '0.1.0';
const DEFAULT_CORE_VERSION = '0.1.0';
const DEFAULT_LOGGER_VERSION = '1.0.0';

const futureReason =
  'Reserved for a later integration slice; no installable artifact or compatibility gate exists yet.';

export const CAPABILITY_REGISTRY: readonly CapabilityDescriptor[] = [
  {
    id: 'core-crud',
    description: 'The mandatory Nest Base CRUD foundation.',
    status: 'available',
    requiredness: 'locked',
    package: '@nest-base/core',
    defaultVersion: DEFAULT_CORE_VERSION,
    dependencySection: 'dependencies',
    compatibility: 'NestJS 11 and Bun 1.3.14 or newer.',
    conflicts: [
      'Cannot be deselected.',
      'Cannot be replaced by a future profile.',
    ],
    ownedPaths: ['.nest-base/manifest.json', 'package.json.nestBase'],
    manualSteps: [
      'Review the generated CRUD package after the artifact gate passes.',
    ],
  },
  {
    id: 'logger',
    description:
      'Structured logging integration for the generated application.',
    status: 'available',
    requiredness: 'optional',
    package: '@nest-base/logger',
    defaultVersion: DEFAULT_LOGGER_VERSION,
    dependencySection: 'dependencies',
    compatibility: 'NestJS 11 and Bun 1.3.14 or newer.',
    conflicts: ['Cannot overwrite an existing logger configuration.'],
    ownedPaths: ['.nest-base/logger.json'],
    manualSteps: [
      'Review logger configuration and connect it to the application logger.',
    ],
  },
  ...(
    ['websocket', 'events', 'kafka', 'pubsub', 'queues', 'generator'] as const
  ).map((id): CapabilityDescriptor => ({
    id,
    description: `Future ${id} capability (shown for roadmap visibility).`,
    status: 'unavailable',
    unavailableReason: futureReason,
    requiredness: 'future',
    package: `@nest-base/${id}`,
    defaultVersion: '0.0.0',
    dependencySection: 'dependencies',
    compatibility: 'Compatibility matrix is not published for this capability.',
    conflicts: ['Selection is rejected until the capability is promoted.'],
    ownedPaths: [`.nest-base/${id}.json`],
    manualSteps: ['Wait for a future wizard release and its artifact gate.'],
  })),
];

const registryById = new Map(
  CAPABILITY_REGISTRY.map((entry) => [entry.id, entry]),
);

export function getCapability(id: string): CapabilityDescriptor {
  const entry = registryById.get(id);
  if (!entry) {
    throw new Error(`Unknown capability "${id}".`);
  }
  return entry;
}

export function resolveCapabilities(
  selected: readonly string[],
): CapabilityDescriptor[] {
  const requested = selected.length > 0 ? [...selected] : ['core-crud'];
  if (!requested.includes('core-crud')) requested.unshift('core-crud');

  const unique = [...new Set(requested)];
  return unique.map((id) => {
    const entry = getCapability(id);
    if (entry.status === 'unavailable') {
      throw new Error(
        `Capability "${id}" is unavailable: ${entry.unavailableReason}`,
      );
    }
    return entry;
  });
}

export function resolveSource(kind: SourceKind, spec: string): Source {
  const trimmed = spec.trim();
  if (!trimmed) throw new Error('A non-empty source spec is required.');
  if (kind === 'file') {
    return { kind, spec: isAbsolute(trimmed) ? trimmed : resolve(trimmed) };
  }
  if (kind === 'url' && !/^https?:\/\//.test(trimmed)) {
    throw new Error('URL sources must use http:// or https://.');
  }
  return { kind, spec: trimmed };
}

export function inferSource(spec: string): Source {
  if (/^https?:\/\//.test(spec)) return resolveSource('url', spec);
  if (
    spec.startsWith('.') ||
    spec.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(spec)
  ) {
    return resolveSource('file', spec);
  }
  return resolveSource('registry', spec);
}

export function makeResolvedCapability(
  descriptor: CapabilityDescriptor,
  version: string,
  source: Source,
  integrity = 'sha512-pending',
): ResolvedCapability {
  if (!version.trim()) throw new Error(`${descriptor.id} version is required.`);
  return {
    id: descriptor.id,
    status: 'enabled',
    package: descriptor.package,
    version: version.trim(),
    source,
    integrity: integrity as `sha512-${string}`,
    ...(descriptor.id === 'generator' ? { model: 'table-crud' as const } : {}),
  };
}
