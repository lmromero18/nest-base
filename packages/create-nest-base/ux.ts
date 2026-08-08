import {
  DEFAULT_WIZARD_VERSION,
  DEFAULT_CORE_INTEGRITY,
  REGISTRY_REVISION,
  getCapability,
  makeResolvedCapability,
  resolveCapabilities,
  resolveSource,
} from './registry';
import type {
  CapabilitySourceInput,
  InteractiveInput,
  NormalizedPlan,
} from './types';

export interface InteractiveCard {
  id: string;
  title: string;
  selectable: boolean;
  message: string;
}

function sourceOrDefault(
  source: CapabilitySourceInput | undefined,
  packageName: string,
  version: string,
) {
  return source
    ? resolveSource(source.kind, source.spec)
    : resolveSource('registry', `${packageName}@${version}`);
}

export function buildInteractiveCards(): InteractiveCard[] {
  return [
    {
      id: 'core-crud',
      title: 'Core CRUD (mandatory)',
      selectable: false,
      message:
        'This capability is mandatory: every Nest Base project starts with the CRUD foundation.',
    },
    {
      id: 'logger',
      title: 'Logger (optional)',
      selectable: true,
      message:
        'This capability is optional: add structured logging when its artifact is available.',
    },
    ...['websocket', 'events', 'kafka', 'pubsub', 'queues', 'generator'].map(
      (id) => {
        const capability = getCapability(id);
        return {
          id,
          title: `${id} (unavailable)`,
          selectable: false,
          message: `This capability is unavailable: ${capability.unavailableReason}`,
        };
      },
    ),
  ];
}

export function normalizeInteractiveInput(
  input: InteractiveInput,
): NormalizedPlan {
  if (!input.target?.trim())
    throw new Error('An interactive target is required.');
  const selected =
    input.selections ??
    (input.logger ? ['core-crud', 'logger'] : ['core-crud']);
  const descriptors = resolveCapabilities(selected);
  const capabilities = descriptors.map((descriptor) => {
    const isLogger = descriptor.id === 'logger';
    const version = isLogger
      ? (input.loggerVersion ?? descriptor.defaultVersion)
      : (input.coreVersion ?? descriptor.defaultVersion);
    const source = sourceOrDefault(
      isLogger ? input.loggerSource : input.coreSource,
      descriptor.package,
      version,
    );
    const integrity = isLogger
      ? input.loggerIntegrity
      : (input.coreIntegrity ??
        (input.coreVersion === undefined && input.coreSource === undefined
          ? DEFAULT_CORE_INTEGRITY
          : undefined));
    return makeResolvedCapability(descriptor, version, source, integrity);
  });

  return {
    schemaVersion: 1,
    wizardVersion: input.wizardVersion ?? DEFAULT_WIZARD_VERSION,
    target: input.target.trim(),
    registryRevision: REGISTRY_REVISION,
    capabilities,
    dependencySections: Object.fromEntries(
      capabilities.map((entry) => [
        entry.id,
        getCapability(entry.id).dependencySection,
      ]),
    ),
    previewOnly: true,
  };
}

export function renderPreview(plan: NormalizedPlan): string {
  const rows = plan.capabilities.map(
    (entry) =>
      `  - ${entry.id}: ${entry.package}@${entry.version} (${entry.source.kind})`,
  );
  return [
    'Create Nest Base plan preview',
    `Target: ${plan.target}`,
    'Capabilities:',
    ...rows,
    'No files, manifests, packages, or installs are written in this phase.',
    'Explicit confirmation required before apply.',
  ].join('\n');
}

export function confirmPlan(
  plan: NormalizedPlan,
  confirmed: boolean,
): NormalizedPlan {
  if (!confirmed)
    throw new Error('Plan was not confirmed. No writes were performed.');
  return plan;
}
