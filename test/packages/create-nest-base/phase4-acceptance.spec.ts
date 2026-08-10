import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  normalizeCiInput,
  runCli,
} from '../../../packages/create-nest-base/cli';
import {
  createPackageManagerAdapter,
  type PackageManager,
} from '../../../packages/create-nest-base/install';

const validIntegrity = `sha512-${Buffer.alloc(64).toString('base64')}`;
const managers: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

describe('create-nest-base Phase 4 acceptance matrix', () => {
  it('documents explicit manager selection, CI flags, and the HTTP-core opt-out', () => {
    const help = runCli({
      ci: false,
      dryRun: false,
      yes: false,
      help: true,
    }).output;

    expect(help).toContain('--package-manager <npm|pnpm|yarn|bun>');
    expect(help).toContain('--select <core-crud,http-core,logger>');
    expect(help).toContain('core-only');
  });

  it('records deterministic availability evidence without substituting managers', () => {
    const available = new Set<PackageManager>(['bun', 'npm']);
    const evidence = managers.map((manager) => {
      let isAvailable = false;
      try {
        const adapter = createPackageManagerAdapter(manager, {
          platform: 'linux',
          resolveExecutable: (executable) =>
            available.has(manager) ? `/ci/bin/${executable}` : undefined,
        });
        isAvailable = Boolean(
          adapter.installCommand('/tmp/generated').executable,
        );
      } catch {
        isAvailable = false;
      }
      return {
        manager,
        available: isAvailable,
      };
    });

    expect(evidence).toEqual([
      { manager: 'npm', available: true },
      { manager: 'pnpm', available: false },
      { manager: 'yarn', available: false },
      { manager: 'bun', available: true },
    ]);
  });

  it('accepts every capability combination with explicit CI artifact inputs', () => {
    const combinations = [
      ['core-crud'],
      ['core-crud', 'logger'],
      ['core-crud', 'http-core'],
      ['core-crud', 'http-core', 'logger'],
    ] as const;

    for (const selections of combinations) {
      const plan = normalizeCiInput({
        ci: true,
        target: './generated',
        packageManager: 'bun',
        selections,
        coreSource: { kind: 'registry', spec: '@nest-base/core@0.1.0' },
        coreVersion: '0.1.0',
        coreIntegrity: validIntegrity,
        loggerSource: { kind: 'registry', spec: '@nest-base/logger@1.0.0' },
        loggerVersion: '1.0.0',
        loggerIntegrity: validIntegrity,
        httpCoreSource: {
          kind: 'registry',
          spec: '@nest-base/http-core@0.1.0',
        },
        httpCoreVersion: '0.1.0',
        httpCoreIntegrity: validIntegrity,
      });

      expect(plan.capabilities.map(({ id }) => id)).toEqual([...selections]);
    }
  });

  it('keeps release publication blocked until all evidence is recorded', () => {
    const release = JSON.parse(
      readFileSync(
        resolve(__dirname, '../../../docs/create-nest-base-release.json'),
        'utf8',
      ),
    ) as {
      publication: { allowed: boolean };
      sequence: string[];
      evidence: Record<string, boolean>;
    };

    expect(release.publication.allowed).toBe(false);
    expect(release.sequence).toEqual([
      '@nest-base/core@0.1.0',
      '@nest-base/http-core@0.1.0 evidence',
      'create-nest-base@0.1.5',
    ]);
    expect(Object.values(release.evidence).every(Boolean)).toBe(false);
  });
});
