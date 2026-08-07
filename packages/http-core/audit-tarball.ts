import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface HttpCorePackedEntry {
  path: string;
  content?: string;
}

const expectedPeers = {
  '@nest-base/core': '>=0.1.0 <0.2.0',
  '@nestjs/common': '>=11.0.0 <12.0.0',
  '@nestjs/swagger': '>=11.0.0 <12.0.0',
  typeorm: '>=0.3.28 <0.4.0',
};

const allowedEntryPatterns = [
  /^package\/(README\.md|LICENSE|package\.json)$/,
  /^package\/dist\/cjs\/package\.json$/,
  /^package\/dist\/(esm|cjs)\/.*\.js(?:\.map)?$/,
  /^package\/dist\/types\/.*\.d\.ts$/,
];

export function inspectHttpCorePackList(
  input: HttpCorePackedEntry[],
): string[] {
  const entries = [...new Set(input.map(({ path }) => path))].sort();
  const violations: string[] = [];
  const manifestEntry = input.find(
    ({ path }) => path === 'package/package.json',
  );
  let manifest: {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  } = {};
  try {
    manifest = JSON.parse(manifestEntry?.content ?? '{}') as typeof manifest;
  } catch {
    violations.push('invalid package metadata package/package.json');
  }
  const runtimeDependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  };
  if (Object.keys(runtimeDependencies).length > 0)
    for (const name of Object.keys(runtimeDependencies).sort())
      violations.push(
        `bundled runtime dependency ${name} in package/package.json`,
      );
  const runtimeDependencyNames = new Set([
    '@nestjs/common',
    '@nestjs/swagger',
    '@nest-base/core',
    'typeorm',
  ]);
  for (const entry of input) {
    for (const name of runtimeDependencyNames)
      if (
        entry.content?.includes(`'${name}'`) ||
        entry.content?.includes(`"${name}"`)
      )
        if (entry.path.startsWith('package/dist/'))
          violations.push(
            `bundled runtime dependency ${name} in ${entry.path}`,
          );
  }
  for (const entry of entries)
    if (!allowedEntryPatterns.some((pattern) => pattern.test(entry)))
      violations.push(`unexpected tarball entry ${entry}`);
  if (!entries.includes('package/LICENSE')) violations.push('missing LICENSE');
  if (!entries.includes('package/README.md'))
    violations.push('missing README.md');
  if (!entries.includes('package/dist/cjs/index.js'))
    violations.push('missing CommonJS entry point dist/cjs/index.js');
  if (!entries.includes('package/dist/cjs/package.json'))
    violations.push('missing CommonJS package boundary dist/cjs/package.json');
  if (!entries.includes('package/dist/types/index.d.ts'))
    violations.push('missing declaration entry point dist/types/index.d.ts');
  if (
    !manifestEntry ||
    JSON.stringify(manifest.peerDependencies) !== JSON.stringify(expectedPeers)
  )
    violations.push('missing peer dependency metadata in package/package.json');
  if (!entries.includes('package/dist/esm/index.js'))
    violations.push('missing ESM entry point dist/esm/index.js');
  return [...new Set(violations)].sort();
}

function main(): void {
  const root = resolve(import.meta.dir);
  const result = Bun.spawnSync(
    ['npm', 'pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' },
  );
  if (result.exitCode !== 0)
    throw new Error(new TextDecoder().decode(result.stderr));
  const report = JSON.parse(new TextDecoder().decode(result.stdout)) as Array<{
    files?: Array<{ path: string }>;
  }>;
  const entries: HttpCorePackedEntry[] = (report[0]?.files ?? []).map(
    ({ path }) => ({
      path: `package/${path}`,
    }),
  );
  const packageManifest = entries.find(
    ({ path }) => path === 'package/package.json',
  );
  if (packageManifest)
    packageManifest.content = readFileSync(
      resolve(root, 'package.json'),
      'utf8',
    );
  const violations = inspectHttpCorePackList(entries);
  if (violations.length)
    throw new Error(`Tarball audit failed:\n${violations.join('\n')}`);
  console.log(`audit:http-core:tarball passed (${entries.length} entries)`);
}

if (import.meta.main) main();
