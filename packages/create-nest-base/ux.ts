import {
  DEFAULT_WIZARD_VERSION,
  DEFAULT_CORE_INTEGRITY,
  assertHttpCoreReleaseEvidence,
  REGISTRY_REVISION,
  getCapability,
  makeResolvedCapability,
  resolveCapabilities,
  resolveSource,
} from './registry.js';
import type {
  CapabilitySourceInput,
  InteractiveInput,
  NormalizedPlan,
} from './types.js';
import { isPackageManager } from './types.js';
import { describePackageManagerCommands } from './install.js';
import { basename } from 'node:path';

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
      id: 'http-core',
      title: 'HTTP Core (optional, recommended)',
      selectable: true,
      message:
        'This optional capability is recommended and selected by default; select core-only to opt out.',
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
  if (
    input.packageManager !== undefined &&
    !isPackageManager(input.packageManager)
  )
    throw new Error('Package manager must be npm, pnpm, yarn, or bun.');
  const selected = input.selections ?? [
    'core-crud',
    ...(input.httpCoreReleaseEvidence ? ['http-core'] : []),
    ...(input.logger ? ['logger'] : []),
  ];
  const descriptors = resolveCapabilities(selected);
  const capabilities = descriptors.map((descriptor) => {
    const isLogger = descriptor.id === 'logger';
    const isHttpCore = descriptor.id === 'http-core';
    const releaseEvidence =
      isHttpCore && input.httpCoreReleaseEvidence
        ? assertHttpCoreReleaseEvidence(input.httpCoreReleaseEvidence)
        : undefined;
    if (
      isHttpCore &&
      !releaseEvidence &&
      input.httpCoreVersion === undefined &&
      input.httpCoreSource === undefined
    )
      throw new Error(
        'HTTP-core recommended default requires bound release evidence.',
      );
    const version = isLogger
      ? (input.loggerVersion ?? descriptor.defaultVersion)
      : isHttpCore
        ? (input.httpCoreVersion ??
          releaseEvidence?.published.version ??
          descriptor.defaultVersion)
        : (input.coreVersion ?? descriptor.defaultVersion);
    const source = sourceOrDefault(
      isLogger
        ? input.loggerSource
        : isHttpCore
          ? input.httpCoreSource
          : input.coreSource,
      descriptor.package,
      version,
    );
    const integrity = isLogger
      ? input.loggerIntegrity
      : isHttpCore
        ? (input.httpCoreIntegrity ??
          (input.httpCoreVersion === undefined &&
          input.httpCoreSource === undefined
            ? releaseEvidence?.published.integrity
            : undefined))
        : (input.coreIntegrity ??
          (input.coreVersion === undefined && input.coreSource === undefined
            ? DEFAULT_CORE_INTEGRITY
            : undefined));
    return makeResolvedCapability(descriptor, version, source, integrity);
  });

  const plan: NormalizedPlan = {
    schemaVersion: 1,
    wizardVersion: input.wizardVersion ?? DEFAULT_WIZARD_VERSION,
    target: input.target.trim(),
    packageManager: input.packageManager ?? 'bun',
    installEnabled: input.installEnabled ?? true,
    registryRevision: REGISTRY_REVISION,
    capabilities: Object.freeze(
      capabilities.map((capability) => Object.freeze(capability)),
    ),
    dependencySections: Object.freeze(
      Object.fromEntries(
        capabilities.map((entry) => [
          entry.id,
          getCapability(entry.id).dependencySection,
        ]),
      ),
    ),
    previewOnly: true,
  };
  return deepFreeze(plan);
}

export function renderPreview(plan: NormalizedPlan): string {
  const commands = describePackageManagerCommands(
    plan.packageManager,
    basename(plan.target),
  );
  const rows = plan.capabilities.map((entry) =>
    [
      `  - ${entry.id}: ${entry.package}${getCapability(entry.id).recommended ? ' (Recommended)' : ''}`,
      `Source: ${entry.source.kind} ${entry.source.spec}`,
      `Version: ${entry.version}`,
      `Integrity: ${entry.integrity}`,
    ].join('\n    '),
  );
  return [
    'Create Nest Base plan preview',
    `Target: ${plan.target}`,
    `Package manager: ${plan.packageManager}`,
    `Install: ${plan.installEnabled ? 'enabled' : 'disabled'}`,
    `Scaffold command: ${commands.scaffold.executable} ${commands.scaffold.args.join(' ')}`,
    `Install command: ${commands.install.executable} ${commands.install.args.join(' ')}`,
    `Registry revision: ${plan.registryRevision}`,
    'Capabilities:',
    ...rows,
    `Action: confirm to create files${plan.installEnabled ? ' and install packages' : ''}`,
    'No files, manifests, packages, or installs are written in this phase.',
    'Explicit confirmation required before apply.',
  ].join('\n');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested);
  }
  return value;
}

export function confirmPlan(
  plan: NormalizedPlan,
  confirmed: boolean,
): NormalizedPlan {
  if (!confirmed)
    throw new Error('Plan was not confirmed. No writes were performed.');
  return plan;
}
