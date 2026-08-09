import { describe, expect, it } from 'bun:test';
import {
  buildInteractiveCards,
  confirmPlan,
  normalizeInteractiveInput,
  renderPreview,
} from '../../../packages/create-nest-base/ux';

describe('create-nest-base interactive UX', () => {
  it('explains mandatory CRUD, optional logger, and unavailable future cards', () => {
    const cards = buildInteractiveCards();
    expect(cards.find((card) => card.id === 'core-crud')?.message).toContain(
      'mandatory',
    );
    expect(cards.find((card) => card.id === 'logger')?.message).toContain(
      'optional',
    );
    expect(cards.find((card) => card.id === 'kafka')?.message).toContain(
      'unavailable',
    );
  });

  it('normalizes an interactive selection into the canonical plan and preview', () => {
    const plan = normalizeInteractiveInput({
      target: './demo',
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
