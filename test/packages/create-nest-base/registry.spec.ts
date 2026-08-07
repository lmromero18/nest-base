import { describe, expect, it } from 'bun:test';
import {
  CAPABILITY_REGISTRY,
  resolveCapabilities,
  resolveSource,
} from '../../../packages/create-nest-base/registry';

describe('create-nest-base capability registry', () => {
  it('keeps CRUD locked, exposes logger, and explains every future capability', () => {
    expect(CAPABILITY_REGISTRY.map((entry) => entry.id)).toEqual([
      'core-crud',
      'logger',
      'websocket',
      'events',
      'kafka',
      'pubsub',
      'queues',
      'generator',
    ]);

    const core = CAPABILITY_REGISTRY[0];
    expect(core.requiredness).toBe('locked');
    expect(core.status).toBe('available');

    for (const entry of CAPABILITY_REGISTRY.slice(2)) {
      expect(entry.status).toBe('unavailable');
      expect(entry.unavailableReason).toBeTruthy();
      expect(entry.compatibility).toBeTruthy();
      expect(entry.dependencySection).toBeTruthy();
      expect(entry.ownedPaths.length).toBeGreaterThan(0);
      expect(entry.conflicts.length).toBeGreaterThan(0);
      expect(entry.manualSteps.length).toBeGreaterThan(0);
    }
  });

  it('fails closed for unknown and unavailable selections before resolution', () => {
    expect(() => resolveCapabilities(['unknown'])).toThrow(
      'Unknown capability',
    );
    expect(() => resolveCapabilities(['websocket'])).toThrow(
      'Capability "websocket" is unavailable',
    );
    expect(resolveCapabilities([]).map((entry) => entry.id)).toEqual([
      'core-crud',
    ]);
    expect(resolveCapabilities(['logger']).map((entry) => entry.id)).toEqual([
      'core-crud',
      'logger',
    ]);
  });

  it('normalizes registry, file, and URL sources deterministically', () => {
    expect(resolveSource('registry', '@nest-base/core@1.2.3')).toEqual({
      kind: 'registry',
      spec: '@nest-base/core@1.2.3',
    });
    expect(resolveSource('file', './packages/core.tgz').spec).toMatch(
      /packages[\\/]core\.tgz$/,
    );
    expect(resolveSource('url', 'https://example.test/core.tgz')).toEqual({
      kind: 'url',
      spec: 'https://example.test/core.tgz',
    });
  });
});
