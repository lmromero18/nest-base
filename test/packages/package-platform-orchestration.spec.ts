import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'bun:test';

const root = resolve(process.cwd());

describe('package-platform root wiring', () => {
  it('exposes frozen-install and repository quality commands', () => {
    const manifest = readJson('package.json') as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(manifest.scripts['install:frozen']).toBe(
      'bun install --frozen-lockfile',
    );
    expect(manifest.scripts['diff:check']).toBe('git diff --check');
    expect(manifest.scripts['quality:check']).toBe(
      'bun run test:focused:check && bun run lint:check && bun run format:check && bun run typecheck && bun run diff:check',
    );
    expect(manifest.scripts['lint:check']).toContain(
      '{src,apps,libs,test,tools,packages}',
    );
    expect(manifest.scripts['format:check']).toContain('docs');
    expect(manifest.devDependencies['@nest-base/core']).toBe('0.1.0');
  });

  it('covers package-platform generated paths without excluding application code', () => {
    const gitignore = readText('.gitignore');
    const eslintConfig = readText('eslint.config.mjs');
    const prettierIgnore = readText('.prettierignore');

    for (const generatedPath of [
      '/packages/core/dist',
      '/packages/core/.build-types',
      '/packages/http-core/dist',
      '/packages/http-core/.build-work',
    ]) {
      expect(gitignore).toContain(generatedPath);
      expect(eslintConfig).toContain(generatedPath.slice(1));
      expect(prettierIgnore).toContain(`${generatedPath.slice(1)}/`);
    }

    expect(eslintConfig).toContain('packages/core/dist/**');
    expect(eslintConfig).toContain('packages/http-core/.build-work/**');
  });

  it('documents reproducible promotion evidence, cleanup, and boundaries', () => {
    const documentation = readText('docs/npm-package-platform.md');
    const normalizedDocumentation = documentation.replace(/\s+/g, ' ');

    for (const section of [
      'Frozen-install-first combined workflow',
      'C0-C4 evidence',
      'Promotion eligibility',
      'Cleanup and reruns',
      'Package roadmap',
      'Scope boundaries',
    ]) {
      expect(normalizedDocumentation).toContain(section);
    }

    for (const excludedScope of [
      'controller/README migration',
      'root metadata cleanup',
      'broad `.vscode` changes',
      'package implementation',
    ]) {
      expect(normalizedDocumentation).toContain(excludedScope);
    }
  });

  it('keeps the frozen lockfile resolution aligned with the root manifest', () => {
    const lockfile = readText('bun.lock');

    expect(lockfile).toContain('"@nest-base/core": "0.1.0"');
    expect(lockfile).toContain('"@nest-base/core@0.1.0"');
    expect(readText('package.json')).toContain('"@nest-base/core": "0.1.0"');
  });
});

function readText(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function readJson(relativePath: string): unknown {
  return JSON.parse(readText(relativePath));
}
