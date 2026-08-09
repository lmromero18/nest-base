import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve(
  process.env.NEST_BASE_CORE_PACKAGE_ROOT ?? import.meta.dir,
);
const distRoot = resolve(packageRoot, 'dist');
const repositoryRoot = resolve(
  process.env.NEST_BASE_REPOSITORY_ROOT ?? resolve(packageRoot, '../..'),
);
const peerDependencies = {
  'reflect-metadata': '>=0.2.0 <0.3.0',
  typeorm: '>=0.3.28 <0.4.0',
};
const forbiddenSourceTokens = [
  '@nestjs/',
  'fastify',
  '@nestjs/swagger',
  'class-validator',
  "from 'pg'",
  'from "pg"',
  'winston',
  'jsonwebtoken',
  'nest-winston',
  'nodemailer',
  'winston-daily-rotate-file',
  'node_modules/@nestjs/',
  'node_modules/typeorm',
  'node_modules/reflect-metadata',
];
const singletonPackages = new Set([
  'typeorm',
  'reflect-metadata',
  '@nestjs/common',
  '@nestjs/core',
]);

export interface RuntimeArtifact {
  path: string;
  source: string;
}

export interface DependencyPackage {
  name: string;
  version: string;
  path: string;
  dependencies?: DependencyPackage[];
}

export interface DependencyAuditInput {
  runtimeFiles: RuntimeArtifact[];
  manifest: {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  dependencyTree: DependencyPackage[];
  peerResolutions: Record<string, string[]>;
  cjsBoundaryExists: boolean;
}

export function inspectDependencyBoundary(
  input: DependencyAuditInput,
): string[] {
  const violations = new Set<string>();
  const runtimeImports = input.runtimeFiles.flatMap(({ path, source }) =>
    findImports(source).map((specifier) => ({ path, specifier })),
  );

  for (const { path, specifier } of runtimeImports) {
    if (forbiddenSourceTokens.some((token) => specifier.includes(token)))
      violations.add(`${path}: forbidden emitted import ${specifier}`);
  }
  for (const { path, source } of input.runtimeFiles) {
    for (const token of forbiddenSourceTokens) {
      if (source.includes(token)) violations.add(`${path}: ${token}`);
    }
  }

  const dependencies = {
    ...input.manifest.dependencies,
    ...input.manifest.optionalDependencies,
  };
  if (Object.keys(dependencies).length > 0)
    violations.add(
      `Core must not declare runtime dependencies: ${Object.keys(dependencies).sort().join(', ')}`,
    );
  if (
    JSON.stringify(input.manifest.peerDependencies) !==
    JSON.stringify(peerDependencies)
  )
    violations.add('Core peer dependency rules changed unexpectedly');

  for (const dependency of flatten(input.dependencyTree)) {
    if (isForbiddenPackage(dependency.name))
      violations.add(
        `forbidden installed runtime dependency: ${dependency.name} at ${dependency.path}`,
      );
  }

  const installed = new Map<string, string[]>();
  for (const dependency of flatten(input.dependencyTree)) {
    if (!singletonPackages.has(dependency.name)) continue;
    const paths = installed.get(dependency.name) ?? [];
    paths.push(dependency.path);
    installed.set(dependency.name, paths);
  }
  for (const [name, paths] of installed) {
    const uniquePaths = sortedUnique(paths);
    if (uniquePaths.length > 1)
      violations.add(
        `duplicate installed ${name} packages: ${uniquePaths.join(', ')}`,
      );
  }

  const auditedPeerNames = new Set([
    ...Object.keys(peerDependencies),
    ...Object.keys(input.peerResolutions),
  ]);
  for (const name of auditedPeerNames) {
    const paths = sortedUnique(input.peerResolutions[name] ?? []);
    if (paths.length === 0)
      violations.add(`peer ${name} externalization could not be proven`);
    if (paths.length > 1)
      violations.add(
        `${name} must resolve to one singleton identity: ${paths.join(', ')}`,
      );
  }
  if (!runtimeImports.some(({ specifier }) => specifier === 'typeorm'))
    violations.add('TypeORM was not retained as an external peer import');
  if (!input.cjsBoundaryExists)
    violations.add('Missing nested CommonJS package boundary');

  return [...violations].sort();
}

function findImports(source: string): string[] {
  return [
    ...source.matchAll(/(?:from|import|require\s*\()\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
}

function flatten(packages: DependencyPackage[]): DependencyPackage[] {
  return packages.flatMap((dependency) => [
    dependency,
    ...flatten(dependency.dependencies ?? []),
  ]);
}

function sortedUnique(paths: string[]): string[] {
  return [...new Set(paths)].sort();
}

function isForbiddenPackage(name: string): boolean {
  return (
    name.startsWith('@nestjs/') ||
    [
      'fastify',
      '@nestjs/swagger',
      'class-validator',
      'pg',
      'winston',
      'jsonwebtoken',
      'nest-winston',
      'nodemailer',
      'winston-daily-rotate-file',
    ].includes(name)
  );
}

function packageTree(root: string): DependencyPackage[] {
  if (!existsSync(root)) return [];
  return packageDirectories(root).map((path) => {
    const manifest = JSON.parse(
      readFileSync(resolve(path, 'package.json'), 'utf8'),
    ) as {
      name?: string;
      version?: string;
    };
    return {
      name: manifest.name ?? resolve(path),
      version: manifest.version ?? 'unknown',
      path,
      dependencies: packageTree(resolve(path, 'node_modules')),
    };
  });
}

function packageDirectories(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory() && entry.name.startsWith('@'))
      return packageDirectories(path);
    return entry.isDirectory() && existsSync(resolve(path, 'package.json'))
      ? [path]
      : [];
  });
}

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

export function collectPeerResolutionPaths(
  names: string[],
  resolutionRoots: string[],
): Record<string, string[]> {
  const requested = new Set(names);
  const paths = new Map<string, Set<string>>(
    names.map((name) => [name, new Set<string>()]),
  );

  for (const root of resolutionRoots) {
    for (const dependency of flatten(
      packageTree(resolve(root, 'node_modules')),
    )) {
      if (requested.has(dependency.name))
        paths.get(dependency.name)?.add(realpathSync(dependency.path));
    }
  }

  return Object.fromEntries(
    names.map((name) => [name, [...(paths.get(name) ?? [])].sort()]),
  );
}

function main(): void {
  const runtimeFiles = files(distRoot)
    .filter((file) => file.endsWith('.js'))
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }));
  const manifest = JSON.parse(
    readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
  ) as DependencyAuditInput['manifest'];
  const violations = inspectDependencyBoundary({
    runtimeFiles,
    manifest,
    dependencyTree: packageTree(resolve(packageRoot, 'node_modules')),
    peerResolutions: collectPeerResolutionPaths(
      [...singletonPackages],
      [repositoryRoot, packageRoot],
    ),
    cjsBoundaryExists:
      statSync(resolve(distRoot, 'cjs/package.json'), {
        throwIfNoEntry: false,
      })?.isFile() ?? false,
  });
  if (violations.length > 0)
    throw new Error(`Core dependency audit failed:\n${violations.join('\n')}`);
  console.log(
    `audit:core passed (${runtimeFiles.length} runtime files; external peers and singleton identities verified)`,
  );
}

if (import.meta.main) main();
