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

export interface HttpCoreRuntimeArtifact {
  path: string;
  source: string;
}

export interface HttpCoreDependencyAuditInput {
  manifest: {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  runtimeFiles: HttpCoreRuntimeArtifact[];
  cjsBoundaryExists: boolean;
}

export function inspectHttpCoreDependencyBoundary(
  input: HttpCoreDependencyAuditInput,
): string[] {
  const violations: string[] = [];
  const dependencies = {
    ...input.manifest.dependencies,
    ...input.manifest.optionalDependencies,
  };
  if (Object.keys(dependencies).length > 0)
    violations.push(
      `HTTP Core must not declare runtime dependencies: ${Object.keys(dependencies).sort().join(', ')}`,
    );
  if (
    JSON.stringify(input.manifest.peerDependencies) !==
    JSON.stringify(expectedPeers)
  )
    violations.push('HTTP Core peer dependency rules changed unexpectedly');
  for (const file of input.runtimeFiles) {
    if (file.source.includes('src/common'))
      violations.push(
        `${file.path}: emitted runtime output references repository source`,
      );
    if (file.source.includes('node_modules/'))
      violations.push(
        `${file.path}: emitted runtime output references node_modules`,
      );
  }
  if (!input.cjsBoundaryExists)
    violations.push('Missing nested CommonJS package boundary');
  return violations.sort();
}

function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(path, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

function main(): void {
  const runtime = files(resolve(root, 'dist')).filter((path) =>
    path.endsWith('.js'),
  );
  const violations = inspectHttpCoreDependencyBoundary({
    manifest,
    runtimeFiles: runtime.map((path) => ({
      path,
      source: readFileSync(path, 'utf8'),
    })),
    cjsBoundaryExists: existsSync(resolve(root, 'dist/cjs/package.json')),
  });
  if (runtime.length === 0)
    violations.push('HTTP Core package build output is incomplete');
  if (
    !runtime.some((path) =>
      readFileSync(path, 'utf8').includes('SuccessResponse'),
    )
  )
    violations.push(
      'HTTP Core runtime output does not contain the adapter contract',
    );
  if (violations.length > 0)
    throw new Error(
      `HTTP Core dependency audit failed:\n${violations.sort().join('\n')}`,
    );
  console.log(
    `audit:http-core passed (${runtime.length} runtime files; peers externalized)`,
  );
}

if (import.meta.main) main();
