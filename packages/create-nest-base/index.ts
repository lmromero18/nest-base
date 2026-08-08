#!/usr/bin/env bun
import {
  createDefaultPipelineDependencies,
  formatHelp,
  parseCliArgs,
  runCliPipeline,
} from './cli.js';

export * from './cli.js';
export * from './artifact-gate.js';
export * from './install.js';
export * from './metadata.js';
export * from './preflight.js';
export * from './registry.js';
export * from './scaffold.js';
export * from './types.js';
export * from './ux.js';

export async function main(
  argv: readonly string[] = Bun.argv.slice(2),
): Promise<number> {
  try {
    const args = parseCliArgs(argv);
    const result = await runCliPipeline(
      args,
      createDefaultPipelineDependencies(args.yes),
    );
    console.log(result.output);
    return result.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(formatHelp());
    return 1;
  }
}

if (require.main === module)
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
