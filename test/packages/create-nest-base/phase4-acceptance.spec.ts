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
import {
  classifyManagerAcceptance,
  evaluateManagerAcceptance,
  evaluateReleaseGate,
  type ManagerAcceptanceEvidence,
} from '../../../packages/create-nest-base/manager-evidence';

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

  it('does not treat available-manager failures as a passing matrix', () => {
    expect(
      classifyManagerAcceptance({ available: false, exitCode: 1 }),
    ).toEqual({
      status: 'unavailable',
      reason: 'executable not found on PATH',
    });
    expect(
      classifyManagerAcceptance({
        available: true,
        exitCode: 1,
        output: 'error: No such built-in module: node:sqlite',
      }),
    ).toEqual({
      status: 'environment-blocked',
      reason: 'node:sqlite unavailable',
    });
    expect(
      classifyManagerAcceptance({
        available: true,
        exitCode: 1,
        output: 'wizard exited with code 1',
      }),
    ).toEqual({ status: 'failed', reason: 'wizard exited with code 1' });

    const evidence: Record<PackageManager, ManagerAcceptanceEvidence> = {
      bun: { status: 'passed' },
      npm: { status: 'passed' },
      pnpm: {
        status: 'environment-blocked',
        reason: 'node:sqlite unavailable',
      },
      yarn: { status: 'unavailable', reason: 'executable not found on PATH' },
    };

    expect(evaluateManagerAcceptance(evidence)).toEqual({
      matrixPassed: false,
      releaseEvidence: false,
      publicationAllowed: false,
      blockers: [
        'pnpm: node:sqlite unavailable',
        'yarn: executable not found on PATH',
      ],
    });
    expect(
      evaluateManagerAcceptance({
        bun: { status: 'passed' },
        npm: { status: 'failed', reason: 'wizard exited with code 1' },
        pnpm: { status: 'unavailable' },
        yarn: { status: 'unavailable' },
      }).releaseEvidence,
    ).toBe(false);

    const partial = evaluateManagerAcceptance({
      bun: { status: 'passed' },
    });
    expect(partial.publicationAllowed).toBe(false);
    expect(partial.blockers).toEqual([
      'npm: result record missing',
      'pnpm: result record missing',
      'yarn: result record missing',
    ]);

    expect(
      evaluateManagerAcceptance({
        bun: { status: 'passed' },
        npm: { status: 'passed' },
        pnpm: { status: 'passed' },
        yarn: { status: 'passed' },
      }).publicationAllowed,
    ).toBe(true);
  });

  it('derives publication from evaluated manager and release evidence', () => {
    const managerAcceptance = {
      bun: { status: 'passed' },
      npm: { status: 'passed' },
      pnpm: {
        status: 'environment-blocked',
        reason: 'node:sqlite unavailable',
      },
      yarn: { status: 'unavailable', reason: 'executable not found on PATH' },
    } satisfies Record<PackageManager, ManagerAcceptanceEvidence>;

    expect(
      evaluateReleaseGate(managerAcceptance, {
        corePackedConsumer: true,
        httpCorePackedConsumer: true,
        releaseAuthentication: false,
      }),
    ).toEqual({
      managerAvailability: false,
      packedWizardMatrix: false,
      releaseAuthentication: false,
      publicationAllowed: false,
      blockers: [
        'pnpm: node:sqlite unavailable',
        'yarn: executable not found on PATH',
        'release authentication incomplete',
      ],
    });
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
      managerAcceptance: Record<string, { status: string; reason?: string }>;
      releaseBlockers: string[];
      evidenceSnapshot: {
        generated: boolean;
        staleSafe: boolean;
        source: string;
        note: string;
      };
    };

    expect(release.publication.allowed).toBe(false);
    expect(release.sequence).toEqual([
      '@nest-base/core@0.1.0',
      '@nest-base/http-core@0.1.0 evidence',
      'create-nest-base@0.1.5',
    ]);
    expect(Object.values(release.evidence).every(Boolean)).toBe(false);
    expect(release.managerAcceptance).toEqual({
      bun: { status: 'passed' },
      npm: { status: 'passed' },
      pnpm: {
        status: 'environment-blocked',
        reason: 'node:sqlite unavailable',
      },
      yarn: { status: 'unavailable', reason: 'executable not found on PATH' },
    });
    expect(release.releaseBlockers).toEqual([
      'pnpm: node:sqlite unavailable',
      'yarn: executable not found on PATH',
      'release authentication incomplete',
    ]);
    const gate = evaluateReleaseGate(release.managerAcceptance, {
      corePackedConsumer: release.evidence.corePackedConsumer,
      httpCorePackedConsumer: release.evidence.httpCorePackedConsumer,
      releaseAuthentication: release.evidence.releaseAuthentication,
    });
    expect(release.evidence.managerAvailability).toBe(gate.managerAvailability);
    expect(release.evidence.packedWizardMatrix).toBe(gate.packedWizardMatrix);
    expect(release.publication.allowed).toBe(gate.publicationAllowed);
    expect(release.releaseBlockers).toEqual(gate.blockers);
    expect(release.evidenceSnapshot).toEqual({
      generated: true,
      staleSafe: true,
      source: 'evaluateReleaseGate',
      note: 'Descriptive release evidence only; publication consumes fresh evaluated results.',
    });
  });

  it('keeps published README release guidance inside the package boundary', () => {
    const readme = readFileSync(
      resolve(__dirname, '../../../packages/create-nest-base/README.md'),
      'utf8',
    );

    expect(readme).not.toContain('../../docs/create-nest-base-release.json');
    expect(readme).toContain('maintained by the repository release gate');
  });
});
