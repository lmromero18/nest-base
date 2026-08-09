import { generateModule, type GenerationResult } from './generator';

export interface CliOptions {
  dryRun: boolean;
  register: boolean;
  help: boolean;
  moduleName?: string;
}

export interface CliResult {
  exitCode: number;
  output: string;
}

export function formatHelp(): string {
  return `Usage:
  bun run module:generate -- [options] <module-name>

Options:
  -h, --help  Show this help.
  --dry-run   Print the deterministic plan without writing files.
  --register  Register the generated module and entity in the supported roots.

Normal invocation writes the complete plan only after preflight and collision checks.
Phase 5A supports standard CRUD modules only. Registration is opt-in; migrations
remain manual and no database is changed.`;
}

export function parseCliArgs(args: readonly string[]): CliOptions {
  let dryRun = false;
  let register = false;
  let help = false;
  const names: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '-h' || argument === '--help') {
      help = true;
      continue;
    }
    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (argument === '--register') {
      register = true;
      continue;
    }
    if (argument === '--auto-register') {
      throw new Error(
        'Unknown option "--auto-register". Use --register explicitly.',
      );
    }
    if (argument === '--mode' || argument === '--type') {
      throw new Error(
        'Non-standard module modes are not supported. Only standard CRUD modules are available.',
      );
    }
    if (argument.startsWith('-')) {
      throw new Error(
        `Unknown option "${argument}". Use --help for supported options.`,
      );
    }
    names.push(argument);
  }

  if (!help && names.length !== 1) {
    throw new Error(
      `Provide exactly one module name. Received ${names.length}. Use --help for usage.`,
    );
  }

  return { dryRun, register, help, moduleName: names[0] };
}

export function runCli(options: CliOptions, cwd: string): CliResult {
  if (options.help) {
    return { exitCode: 0, output: formatHelp() };
  }

  try {
    const result = generateModule(options.moduleName!, {
      dryRun: options.dryRun,
      register: options.register,
      cwd,
    });
    return {
      exitCode: 0,
      output: formatPlan(result, options.register, cwd),
    };
  } catch (error) {
    return {
      exitCode: 1,
      output:
        error instanceof Error
          ? error.message
          : 'Unable to create generation plan.',
    };
  }
}

function formatPlan(
  result: GenerationResult,
  register: boolean,
  cwd: string,
): string {
  const { plan, dryRun, written, registered } = result;
  const mode = register
    ? dryRun
      ? 'REGISTER: DRY RUN'
      : registered
        ? written
          ? 'REGISTERED'
          : 'REGISTER: ALREADY REGISTERED'
        : 'REGISTER: PLAN'
    : dryRun
      ? 'DRY RUN'
      : written
        ? 'GENERATED'
        : 'PLAN';
  const files = plan.files
    .map(({ relativePath }) => `  - ${relativePath}`)
    .join('\n');

  const registrationPreview =
    register && dryRun && result.registration
      ? formatRegistrationPreview(result.registration)
      : '';

  return `${mode}: standard CRUD module "${plan.name.moduleName}"
Destination: ${cwd}
Identifiers: route=${plan.name.route}, class=${plan.name.className}, table=${plan.name.tableName}
Planned files:
${files}
${registrationPreview}

Completion guidance:
  1. ${register ? 'Review the published module registration.' : `Register ${plan.name.className}Module manually in src/app.module.ts.`}
  2. ${register ? 'Review the published entity registration.' : `Register ${plan.name.entityName} in the BASE data-source configuration in data-source.ts.`}
  3. Create and review a migration for ${plan.name.tableName} before applying it.
  4. ${register ? 'Run migration:show and the existing human-reviewed workflow; no migration or database mutation is performed.' : 'Automatic registration and migration writes are intentionally unsupported.'}`;
}

function formatRegistrationPreview(
  registration: NonNullable<GenerationResult['registration']>,
): string {
  const entries = registration.previews
    .map((preview) => {
      if (preview.action === 'create') {
        return `  - create ${preview.path}`;
      }

      return [
        `  - edit ${preview.path}`,
        `    import: import { ${preview.symbol} } from '${preview.importPath}';`,
        `    member: add ${preview.symbol} to ${
          preview.memberCollection === 'imports'
            ? '@Module imports'
            : 'DataSource entities'
        }`,
      ].join('\n');
    })
    .join('\n');

  return `\nRegistration preview:\n${entries}`;
}

const entrypoint = process.argv[1]?.replaceAll('\\', '/');

if (entrypoint?.endsWith('/tools/module-generator/cli.ts')) {
  try {
    const result = runCli(parseCliArgs(process.argv.slice(2)), process.cwd());
    console.log(result.output);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Unable to parse arguments.',
    );
    process.exitCode = 1;
  }
}
