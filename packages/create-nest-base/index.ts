#!/usr/bin/env bun
import {
  createDefaultPipelineDependencies,
  formatHelp,
  parseCliArgs,
  runCliPipeline,
} from './cli';

export * from './cli';
export * from './artifact-gate';
export * from './install';
export * from './metadata';
export * from './preflight';
export * from './registry';
export * from './scaffold';
export * from './types';
export * from './ux';

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
