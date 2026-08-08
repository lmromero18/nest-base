import {
  createRegistryArtifactLoader,
  inferSource,
  inspectPackedArtifact,
  resolveCapabilities,
} from './registry.js';
import { resolveArtifact } from './artifact-gate.js';
import {
  defaultFileSystem,
  preflightTarget,
  type TargetFileSystem,
} from './preflight.js';
import {
  buildScaffoldCommand,
  verifyVanillaScaffold,
  type ScaffoldCommand,
  type ScaffoldFileSystem,
} from './scaffold.js';
import type {
  ArtifactLoaders,
  ArtifactRecord,
  IndependentConsumerGate,
} from './artifact-gate.js';
import { confirmPlan, normalizeInteractiveInput, renderPreview } from './ux.js';
import type { CiInput, NormalizedPlan, ParsedCliArgs } from './types.js';
import { dirname, basename } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  applyOwnedWrites,
  buildMetadataPreview,
  createMetadataFileSystem,
  rollbackOwnedWrites,
  type MetadataFileSystem,
} from './metadata.js';

export interface CliPipelineDependencies {
  fileSystem: TargetFileSystem;
  artifactLoaders: ArtifactLoaders;
  independentConsumerGate?: IndependentConsumerGate;
  bunVersion?: string;
  confirm: (plan: NormalizedPlan) => Promise<void>;
  scaffold: (command: ScaffoldCommand, cwd: string) => Promise<void>;
  scaffoldFileSystem: ScaffoldFileSystem;
  metadataFileSystem?: MetadataFileSystem;
  install: (command: { cwd: string; args: ['install'] }) => Promise<void>;
}

export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  const result: ParsedCliArgs = {
    ci: false,
    dryRun: false,
    yes: false,
    help: false,
    retry: false,
  };
  const selections: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--ci') result.ci = true;
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--yes') result.yes = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--retry') result.retry = true;
    else if (arg === '--logger') selections.push('logger');
    else if (arg === '--select')
      selections.push(...requiredValue(arg, next).split(','));
    else if (arg === '--target') result.target = requiredValue(arg, next);
    else if (arg === '--core-version')
      result.coreVersion = requiredValue(arg, next);
    else if (arg === '--core-source')
      result.coreSource = requiredValue(arg, next);
    else if (arg === '--core-integrity')
      result.coreIntegrity = requiredValue(arg, next) as `sha512-${string}`;
    else if (arg === '--logger-version')
      result.loggerVersion = requiredValue(arg, next);
    else if (arg === '--logger-source')
      result.loggerSource = requiredValue(arg, next);
    else if (arg === '--logger-integrity')
      result.loggerIntegrity = requiredValue(arg, next) as `sha512-${string}`;
    else throw new Error(`Unknown option "${arg}".`);
    if (
      [
        '--select',
        '--target',
        '--core-version',
        '--core-source',
        '--core-integrity',
        '--logger-version',
        '--logger-source',
        '--logger-integrity',
      ].includes(arg)
    )
      index += 1;
  }
  if (selections.length > 0)
    result.selections = selections
      .map((selection) => selection.trim())
      .filter(Boolean);
  return result;
}

function requiredValue(option: string, value: string | undefined): string {
  if (!value || value.startsWith('--'))
    throw new Error(`${option} requires a value.`);
  return value;
}

export function normalizeCiInput(input: CiInput): NormalizedPlan {
  if (!input.target?.trim())
    throw new Error('CI mode requires an explicit target.');
  const target = input.target;
  const selections = input.selections ?? ['core-crud'];
  const descriptors = resolveCapabilities(selections);
  requireCiArtifact(
    'core',
    input.coreSource,
    input.coreVersion,
    input.coreIntegrity,
  );
  const hasLogger = descriptors.some((entry) => entry.id === 'logger');
  if (hasLogger)
    requireCiArtifact(
      'logger',
      input.loggerSource,
      input.loggerVersion,
      input.loggerIntegrity,
    );
  return normalizeInteractiveInput({
    ...input,
    target,
    logger: hasLogger,
    coreSource: input.coreSource,
    coreVersion: input.coreVersion,
    coreIntegrity: input.coreIntegrity,
    loggerSource: input.loggerSource,
    loggerVersion: input.loggerVersion,
    loggerIntegrity: input.loggerIntegrity,
  });
}

function requireCiArtifact(
  capability: string,
  source: CiInput['coreSource'],
  version: CiInput['coreVersion'],
  integrity: CiInput['coreIntegrity'],
): void {
  if (!source) throw new Error(`CI mode requires ${capability} source.`);
  if (!version) throw new Error(`CI mode requires ${capability} version.`);
  if (
    !integrity ||
    !/^sha512-.+/.test(integrity) ||
    integrity === 'sha512-pending'
  )
    throw new Error(`CI mode requires ${capability} integrity.`);
}

export function normalizeParsedCli(args: ParsedCliArgs): NormalizedPlan {
  if (args.ci) {
    return normalizeCiInput({
      ci: true,
      target: args.target ?? '',
      selections: args.selections,
      coreVersion: args.coreVersion,
      coreSource: args.coreSource ? inferSource(args.coreSource) : undefined,
      coreIntegrity: args.coreIntegrity,
      loggerVersion: args.loggerVersion,
      loggerSource: args.loggerSource
        ? inferSource(args.loggerSource)
        : undefined,
      loggerIntegrity: args.loggerIntegrity,
    });
  }
  return normalizeInteractiveInput({
    target: args.target ?? '',
    logger: args.selections?.includes('logger'),
    selections: args.selections,
    coreVersion: args.coreVersion,
    coreSource: args.coreSource ? inferSource(args.coreSource) : undefined,
    coreIntegrity: args.coreIntegrity,
    loggerVersion: args.loggerVersion,
    loggerSource: args.loggerSource
      ? inferSource(args.loggerSource)
      : undefined,
    loggerIntegrity: args.loggerIntegrity,
  });
}

export function serializePlan(plan: NormalizedPlan): string {
  return JSON.stringify(plan);
}

export function runCli(args: ParsedCliArgs): {
  exitCode: number;
  output: string;
  plan?: NormalizedPlan;
};
export function runCli(
  args: ParsedCliArgs,
  dependencies: CliPipelineDependencies,
): Promise<{ exitCode: number; output: string; plan?: NormalizedPlan }>;
export function runCli(
  args: ParsedCliArgs,
  dependencies?: CliPipelineDependencies,
):
  | { exitCode: number; output: string; plan?: NormalizedPlan }
  | Promise<{ exitCode: number; output: string; plan?: NormalizedPlan }> {
  if (args.yes && !args.ci)
    throw new Error('--yes is only supported in CI mode.');
  if (args.help) return { exitCode: 0, output: formatHelp() };
  if (args.ci && !args.yes && !args.dryRun)
    throw new Error('CI mode requires --yes or --dry-run.');
  const plan = normalizeParsedCli(args);
  if (dependencies) return executePipeline(args, plan, dependencies);
  if (args.ci && args.yes) {
    const confirmedPlan = confirmPlan(plan, true);
    return {
      exitCode: 0,
      output: renderPreview(confirmedPlan),
      plan: confirmedPlan,
    };
  }
  return { exitCode: 0, output: renderPreview(plan), plan };
}

async function executePipeline(
  args: ParsedCliArgs,
  plan: NormalizedPlan,
  dependencies: CliPipelineDependencies,
): Promise<{ exitCode: number; output: string; plan: NormalizedPlan }> {
  const preflight = preflightTarget(
    plan.target,
    dependencies.fileSystem,
    dependencies.bunVersion,
    args.retry,
  );
  const verifiedArtifacts = new Map<string, ArtifactRecord>();
  for (const capability of plan.capabilities) {
    const artifact = await resolveArtifact(
      {
        kind: capability.source.kind,
        spec: capability.source.spec,
        package: capability.package,
        version: capability.version,
        integrity: capability.integrity,
      },
      dependencies.artifactLoaders,
      dependencies.independentConsumerGate,
    );
    verifiedArtifacts.set(capability.id, artifact);
  }
  await dependencies.confirm(plan);
  if (args.dryRun) return { exitCode: 0, output: renderPreview(plan), plan };

  const projectName = basename(preflight.target);
  if (!preflight.existing || !args.retry)
    await dependencies.scaffold(
      buildScaffoldCommand(projectName),
      dirname(preflight.target),
    );
  verifyVanillaScaffold(preflight.target, dependencies.scaffoldFileSystem);
  const metadataFileSystem = dependencies.metadataFileSystem;
  const metadata = metadataFileSystem
    ? buildMetadataPreview(plan, metadataFileSystem, verifiedArtifacts)
    : undefined;
  if (metadata && metadataFileSystem)
    applyOwnedWrites(metadata, metadataFileSystem);
  try {
    await dependencies.install({ cwd: preflight.target, args: ['install'] });
  } catch (error) {
    if (metadata && metadataFileSystem) {
      const rollback = rollbackOwnedWrites(metadata, metadataFileSystem);
      const detail = rollback.leftovers.length
        ? ` Leftovers: ${rollback.leftovers.join(', ')}. Recovery is required.`
        : ' Rollback completed.';
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${detail}`,
      );
    }
    throw error;
  }
  return { exitCode: 0, output: renderPreview(plan), plan };
}

export function runCliPipeline(
  args: ParsedCliArgs,
  dependencies: CliPipelineDependencies,
): Promise<{ exitCode: number; output: string; plan?: NormalizedPlan }> {
  return Promise.resolve(runCli(args, dependencies));
}

export function createDefaultPipelineDependencies(
  confirmed: boolean,
): CliPipelineDependencies {
  return {
    fileSystem: defaultFileSystem,
    artifactLoaders: {
      registry: createRegistryArtifactLoader(),
      file: () => Promise.resolve(undefined),
      url: () => Promise.resolve(undefined),
      inspect: inspectPackedArtifact,
    },
    confirm: () => {
      if (confirmed) return Promise.resolve();
      const answer = prompt(
        'Apply this plan and create the project? Type "yes" to continue: ',
      );
      return answer?.trim().toLowerCase() === 'yes'
        ? Promise.resolve()
        : Promise.reject(
            new Error('Plan was not confirmed. No writes were performed.'),
          );
    },
    scaffold: async (command, cwd) => {
      const process = Bun.spawn([command.executable, ...command.args], {
        cwd,
        stdout: 'inherit',
        stderr: 'inherit',
      });
      if ((await process.exited) !== 0)
        throw new Error('Nest scaffold command failed.');
    },
    scaffoldFileSystem: {
      readPackage: (path) => {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        return parsed !== null && typeof parsed === 'object' ? parsed : {};
      },
      isDirectory: (path) => defaultFileSystem.isDirectory(path),
    },
    metadataFileSystem: createMetadataFileSystem(),
    install: async (command) => {
      const process = Bun.spawn(['bun', ...command.args], {
        cwd: command.cwd,
        stdout: 'inherit',
        stderr: 'inherit',
      });
      if ((await process.exited) !== 0) throw new Error('Bun install failed.');
    },
  };
}

export function formatHelp(): string {
  return [
    'create-nest-base [--ci] --target <directory> [options]',
    '--select <core-crud,logger>  Select capabilities (core-crud is mandatory).',
    '--dry-run                   Preview the normalized plan without writes.',
    '--yes                       Confirm a complete plan in CI.',
    '--retry                     Retry installation in an existing scaffold without deleting files.',
  ].join('\n');
}
