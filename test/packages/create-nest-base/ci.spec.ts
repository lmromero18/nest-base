import { describe, expect, it } from 'bun:test';
import {
  normalizeCiInput,
  parseCliArgs,
  runCli,
  serializePlan,
} from '../../../packages/create-nest-base/cli';
import { normalizeInteractiveInput } from '../../../packages/create-nest-base/ux';

describe('create-nest-base CI normalization', () => {
  it('requires explicit CI target and selected capability sources/versions', () => {
    expect(() => normalizeCiInput({ ci: true })).toThrow('target');
    expect(() => normalizeCiInput({ ci: true, target: './demo' })).toThrow(
      'core source',
    );
    expect(() =>
      normalizeCiInput({
        ci: true,
        target: './demo',
        coreVersion: '1.2.3',
        coreIntegrity: 'sha512-core',
      }),
    ).toThrow('core source');
    expect(() =>
      normalizeCiInput({
        ci: true,
        target: './demo',
        coreSource: { kind: 'registry', spec: '@nest-base/core@1.2.3' },
        coreIntegrity: 'sha512-core',
      }),
    ).toThrow('core version');
    expect(() =>
      normalizeCiInput({
        ci: true,
        target: './demo',
        coreSource: { kind: 'registry', spec: '@nest-base/core@1.2.3' },
        coreVersion: '1.2.3',
      }),
    ).toThrow('core integrity');
    expect(() =>
      normalizeCiInput({
        ci: true,
        target: './demo',
        coreSource: { kind: 'registry', spec: '@nest-base/core@1.2.3' },
        coreVersion: '1.2.3',
        coreIntegrity: 'sha512-pending',
      }),
    ).toThrow('integrity');
    expect(() =>
      normalizeCiInput({
        ci: true,
        target: './demo',
        selections: ['logger'],
        coreSource: { kind: 'registry', spec: '@nest-base/core@1.2.3' },
        coreVersion: '1.2.3',
        coreIntegrity: 'sha512-core',
      }),
    ).toThrow('logger source');
    expect(() =>
      normalizeCiInput({
        ci: true,
        target: './demo',
        selections: ['logger'],
        coreSource: { kind: 'registry', spec: '@nest-base/core@1.2.3' },
        coreVersion: '1.2.3',
        coreIntegrity: 'sha512-core',
        loggerSource: { kind: 'registry', spec: '@nest-base/logger@2.0.0' },
        loggerIntegrity: 'sha512-logger',
      }),
    ).toThrow('logger version');
    expect(() =>
      normalizeCiInput({
        ci: true,
        target: './demo',
        selections: ['logger'],
        coreSource: { kind: 'registry', spec: '@nest-base/core@1.2.3' },
        coreVersion: '1.2.3',
        coreIntegrity: 'sha512-core',
        loggerSource: { kind: 'registry', spec: '@nest-base/logger@2.0.0' },
        loggerVersion: '2.0.0',
      }),
    ).toThrow('logger integrity');
    expect(() =>
      normalizeCiInput({
        ci: true,
        target: './demo',
        selections: ['websocket'],
      }),
    ).toThrow('unavailable');
  });

  it('produces byte-equivalent CI and interactive plans', () => {
    const input = {
      target: './demo',
      selections: ['logger'],
      coreVersion: '1.2.3',
      coreSource: { kind: 'registry' as const, spec: '@nest-base/core@1.2.3' },
      coreIntegrity: 'sha512-core' as const,
      loggerVersion: '2.0.0',
      loggerSource: {
        kind: 'registry' as const,
        spec: '@nest-base/logger@2.0.0',
      },
      loggerIntegrity: 'sha512-logger' as const,
      wizardVersion: '0.1.0',
    };
    expect(serializePlan(normalizeCiInput({ ...input, ci: true }))).toBe(
      serializePlan(normalizeInteractiveInput({ ...input, logger: true })),
    );
  });

  it('parses explicit CI flags and dry-run without creating side effects', () => {
    expect(
      parseCliArgs([
        '--ci',
        '--dry-run',
        '--target',
        './demo',
        '--select',
        'core-crud',
        '--core-version',
        '1.2.3',
        '--core-source',
        '@nest-base/core@1.2.3',
        '--core-integrity',
        'sha512-core',
      ]),
    ).toMatchObject({ ci: true, dryRun: true, target: './demo' });
  });

  it('accepts a complete explicit CI plan and rejects silently ignored confirmation flags', () => {
    const args = parseCliArgs([
      '--ci',
      '--yes',
      '--target',
      './demo',
      '--core-version',
      '1.2.3',
      '--core-source',
      '@nest-base/core@1.2.3',
      '--core-integrity',
      'sha512-core',
    ]);

    expect(runCli(args).exitCode).toBe(0);
    expect(() => runCli({ ...args, yes: false })).toThrow('--yes');
    expect(() => runCli({ ...args, ci: false })).toThrow('--yes');
    expect(runCli({ ...args, dryRun: true, yes: false }).output).toContain(
      'No files',
    );
  });
});
