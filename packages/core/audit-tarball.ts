import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectPackList, type PackedEntry } from './tarball.js';
import { withCoreOutputLock } from '../../tools/core-run-context.js';

const packageRoot = resolve(
  process.env.NEST_BASE_CORE_PACKAGE_ROOT ?? import.meta.dir,
);

function runPackDryRun(): PackedEntry[] {
  const result = Bun.spawnSync(
    ['npm', 'pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: packageRoot, stdout: 'pipe', stderr: 'pipe' },
  );
  if (result.exitCode !== 0)
    throw new Error(
      `Tarball inspection could not run npm pack: ${decode(result.stderr)}`,
    );

  let report: Array<{ files?: Array<{ path: string }> }>;
  try {
    report = JSON.parse(decode(result.stdout)) as Array<{
      files?: Array<{ path: string }>;
    }>;
  } catch {
    throw new Error(
      `Tarball inspection received invalid npm pack JSON: ${decode(result.stdout)}`,
    );
  }
  const files = report[0]?.files;
  if (!files)
    throw new Error('Tarball inspection received no packed file list');
  return files.map(({ path }) => ({ path: `package/${path}` }));
}

function main(): void {
  const entries = runPackDryRun();
  const inspection = inspectPackList(
    entries.map((entry) => ({
      ...entry,
      content: readPackedContent(entry.path),
    })),
  );
  console.log(
    `audit:tarball entries (${inspection.entries.length}):\n${inspection.entries.join('\n')}`,
  );
  if (inspection.violations.length > 0)
    throw new Error(
      `Tarball audit failed:\n${inspection.violations.join('\n')}`,
    );
  console.log('audit:tarball passed (deterministic allowlist verified)');
}

function readPackedContent(path: string): string | undefined {
  const relative = path.replace(/^package\//, '');
  if (relative === 'package.json')
    return readFileSync(resolve(packageRoot, relative), 'utf8');
  if (relative === 'README.md' || relative === 'LICENSE')
    return readFileSync(resolve(packageRoot, relative), 'utf8');
  if (relative.startsWith('dist/')) {
    try {
      return readFileSync(resolve(packageRoot, relative), 'utf8');
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function decode(value: Uint8Array): string {
  return new TextDecoder().decode(value).trim();
}

if (import.meta.main) withCoreOutputLock(main);
