export type CapabilityStatus = 'available' | 'unavailable';
export type CapabilityRequiredness = 'locked' | 'optional' | 'future';
export type SourceKind = 'registry' | 'file' | 'url';
export type GeneratorModel = 'table-crud' | 'view' | 'read-only';
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;

export function isPackageManager(value: unknown): value is PackageManager {
  return (
    typeof value === 'string' &&
    (PACKAGE_MANAGERS as readonly string[]).includes(value)
  );
}

export interface Source {
  kind: SourceKind;
  spec: string;
}

export interface CapabilityDescriptor {
  id: string;
  description: string;
  status: CapabilityStatus;
  unavailableReason?: string;
  requiredness: CapabilityRequiredness;
  recommended: boolean;
  defaultSelectedInteractive: boolean;
  package: string;
  defaultVersion: string;
  defaultSource: Source;
  defaultIntegrity?: `sha512-${string}`;
  dependencySection: 'dependencies' | 'devDependencies';
  compatibility: string;
  conflicts: string[];
  ownedPaths: string[];
  manualSteps: string[];
}

export interface ResolvedCapability {
  id: string;
  status: 'enabled';
  package: string;
  version: string;
  source: Source;
  integrity: `sha512-${string}`;
  model?: GeneratorModel;
}

export interface HttpCoreReleaseEvidence {
  schema: 'http-core-release-evidence/v1';
  package: '@nest-base/http-core';
  version: string;
  integrity: `sha512-${string}`;
  published: {
    package: '@nest-base/http-core';
    version: string;
    integrity: `sha512-${string}`;
    tarball: string;
  };
  artifactDigest: `sha512-${string}`;
  audit: {
    tool: 'http-core-tarball-audit';
    package: '@nest-base/http-core';
    version: string;
    artifactDigest: `sha512-${string}`;
    status: 'passed';
  };
  consumer: {
    tool: 'http-core-independent-consumer';
    package: '@nest-base/http-core';
    version: string;
    artifactDigest: `sha512-${string}`;
    status: 'passed';
    modes: readonly ['esm', 'cjs'];
  };
  evidenceDigest: `sha256-${string}`;
}

export interface NormalizedPlan {
  schemaVersion: 1;
  wizardVersion: string;
  target: string;
  packageManager: PackageManager;
  installEnabled: boolean;
  registryRevision: string;
  capabilities: readonly ResolvedCapability[];
  dependencySections: Readonly<
    Record<string, 'dependencies' | 'devDependencies'>
  >;
  previewOnly: boolean;
}

export interface CapabilitySourceInput {
  kind: SourceKind;
  spec: string;
}

export interface InteractiveInput {
  target: string;
  packageManager?: PackageManager;
  installEnabled?: boolean;
  logger?: boolean;
  selections?: readonly string[];
  coreVersion?: string;
  coreSource?: CapabilitySourceInput;
  coreIntegrity?: string;
  loggerVersion?: string;
  loggerSource?: CapabilitySourceInput;
  loggerIntegrity?: string;
  httpCoreVersion?: string;
  httpCoreSource?: CapabilitySourceInput;
  httpCoreIntegrity?: string;
  wizardVersion?: string;
  httpCoreReleaseEvidence?: HttpCoreReleaseEvidence;
}

export interface CiInput extends Omit<InteractiveInput, 'target'> {
  ci: true;
  target?: string;
}

export interface ParsedCliArgs {
  ci: boolean;
  dryRun: boolean;
  yes: boolean;
  help: boolean;
  retry?: boolean;
  target?: string;
  packageManager?: PackageManager;
  skipInstall?: boolean;
  strict?: boolean;
  skipGit?: boolean;
  selections?: readonly string[];
  coreVersion?: string;
  coreSource?: string;
  coreIntegrity?: `sha512-${string}`;
  loggerVersion?: string;
  loggerSource?: string;
  loggerIntegrity?: `sha512-${string}`;
  httpCoreVersion?: string;
  httpCoreSource?: string;
  httpCoreIntegrity?: `sha512-${string}`;
}
