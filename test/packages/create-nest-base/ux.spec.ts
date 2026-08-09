import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  buildInteractiveCards,
  confirmPlan,
  normalizeInteractiveInput,
  renderPreview,
} from '../../../packages/create-nest-base/ux';
import { createHttpCoreReleaseEvidence } from '../../../packages/create-nest-base/registry';

const releaseEvidence = createHttpCoreReleaseEvidence({
  package: '@nest-base/http-core',
  version: '0.1.0',
  integrity: `sha512-${createHash('sha512').update(new Uint8Array(64)).digest('base64')}`,
  tarballUrl:
    'https://registry.npmjs.org/@nest-base/http-core/-/http-core-0.1.0.tgz',
  tarballBytes: new Uint8Array(64),
  audit: {
    tool: 'http-core-tarball-audit',
    package: '@nest-base/http-core',
    version: '0.1.0',
    artifactDigest: `sha512-${createHash('sha512').update(new Uint8Array(64)).digest('base64')}`,
    status: 'passed',
  },
  consumer: {
    tool: 'http-core-independent-consumer',
    package: '@nest-base/http-core',
    version: '0.1.0',
    artifactDigest: `sha512-${createHash('sha512').update(new Uint8Array(64)).digest('base64')}`,
    status: 'passed',
    modes: ['esm', 'cjs'],
  },
});

describe('create-nest-base interactive UX', () => {
  it('explains mandatory CRUD, optional logger, and unavailable future cards', () => {
    const cards = buildInteractiveCards();
    expect(cards.find((card) => card.id === 'core-crud')?.message).toContain(
      'mandatory',
    );
    const httpCoreCard = cards.find((card) => card.id === 'http-core');
    expect(httpCoreCard?.selectable).toBe(true);
    expect(httpCoreCard?.title).toContain('recommended');
    expect(cards.find((card) => card.id === 'kafka')?.message).toContain(
      'unavailable',
    );
  });

  it('normalizes an interactive selection into the canonical plan and preview', () => {
    const plan = normalizeInteractiveInput({
      target: './demo',
      selections: ['core-crud', 'logger'],
      logger: true,
      coreVersion: '1.2.3',
      coreSource: { kind: 'registry', spec: '@nest-base/core@1.2.3' },
      loggerVersion: '2.0.0',
      loggerSource: { kind: 'registry', spec: '@nest-base/logger@2.0.0' },
      wizardVersion: '0.1.0',
    });

    expect(plan.capabilities.map((entry) => entry.id)).toEqual([
      'core-crud',
      'logger',
    ]);
    expect(renderPreview(plan)).toContain('Explicit confirmation required');
    expect(renderPreview(plan)).toContain('./demo');
  });

  it('selects recommended HTTP core interactively and allows explicit core-only opt-out', () => {
    const recommended = normalizeInteractiveInput({
      target: './demo',
      httpCoreReleaseEvidence: releaseEvidence,
    });
    expect(recommended.capabilities.map((entry) => entry.id)).toEqual([
      'core-crud',
      'http-core',
    ]);
    expect(recommended.capabilities[1]).toMatchObject({
      package: '@nest-base/http-core',
      version: '0.1.0',
      source: { kind: 'registry', spec: '@nest-base/http-core@0.1.0' },
      integrity: releaseEvidence.integrity,
    });
    expect(
      normalizeInteractiveInput({
        target: './demo',
        selections: ['core-crud'],
      }).capabilities.map((entry) => entry.id),
    ).toEqual(['core-crud']);
    expect(renderPreview(recommended)).toContain('Recommended');
  });

  it('assigns the published core tarball integrity to the default capability', () => {
    const plan = normalizeInteractiveInput({ target: 'C:\\demo' });

    expect(plan.capabilities[0]).toMatchObject({
      package: '@nest-base/core',
      version: '0.1.0',
      source: { kind: 'registry', spec: '@nest-base/core@0.1.0' },
      integrity:
        'sha512-wjDf/s0C9qVaXHhtwJV38Dr9rZuxLWFxuqT1gPgK5WJ33zJw2TEixpV22EcPn1iY8YI3ErgGOzktv8ywtqty/g==',
    });
  });

  it('does not reuse the default integrity for an explicit core artifact', () => {
    const plan = normalizeInteractiveInput({
      target: 'C:\\demo',
      coreVersion: '1.2.3',
      coreSource: { kind: 'registry', spec: '@nest-base/core@1.2.3' },
    });

    expect(plan.capabilities[0].integrity).toBe('sha512-pending');
  });

  it('accepts and cancels confirmation explicitly', () => {
    const plan = normalizeInteractiveInput({ target: './demo' });

    expect(confirmPlan(plan, true)).toBe(plan);
    expect(() => confirmPlan(plan, false)).toThrow(
      'Plan was not confirmed. No writes were performed.',
    );
  });
});
