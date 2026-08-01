import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir);
const manifest = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
) as {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const expectedPeers = {
  '@nest-base/core': '>=0.1.0 <0.2.0',
  '@nestjs/common': '>=11.0.0 <12.0.0',
  '@nestjs/swagger': '>=11.0.0 <12.0.0',
  typeorm: '>=0.3.28 <0.4.0',
};

function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(path, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

function main(): void {
  if (manifest.dependencies || manifest.optionalDependencies)
    throw new Error('HTTP Core package must not bundle runtime peers');
  if (
    JSON.stringify(manifest.peerDependencies) !== JSON.stringify(expectedPeers)
  )
    throw new Error('HTTP Core peer dependency rules changed unexpectedly');
  const runtime = files(resolve(root, 'dist')).filter((path) =>
    path.endsWith('.js'),
  );
  if (
    !existsSync(resolve(root, 'dist/cjs/package.json')) ||
    runtime.length === 0
  )
    throw new Error('HTTP Core package build output is incomplete');
  const text = runtime.map((path) => readFileSync(path, 'utf8')).join('\n');
  if (text.includes('src/common') || text.includes('SuccessResponse') === false)
    throw new Error(
      'HTTP Core runtime output does not contain the adapter contract',
    );
  if (text.includes('node_modules/'))
    throw new Error('HTTP Core output references node_modules');
  console.log(
    `audit:http-core passed (${runtime.length} runtime files; peers externalized)`,
  );
}

main();
