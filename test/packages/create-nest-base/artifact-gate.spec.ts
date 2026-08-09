import { createHash } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import { resolveArtifact } from '../../../packages/create-nest-base/artifact-gate';

const bytes = new TextEncoder().encode('not-a-real-package-fixture');
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('create-nest-base artifact gate', () => {
  it('fails when the mandatory artifact is unavailable or the consumer gate is false', async () => {
    expect(
      await rejectionMessage(
        resolveArtifact(
          {
            kind: 'registry',
            spec: '@nest-base/core@1.0.0',
            package: '@nest-base/core',
            version: '1.0.0',
            integrity,
          },
          { registry: () => Promise.resolve(undefined) },
        ),
      ),
    ).toContain('unavailable');

    expect(
      resolveArtifact(
        {
          kind: 'registry',
          spec: '@nest-base/core@1.0.0',
          package: '@nest-base/core',
          version: '1.0.0',
          integrity,
        },
        {
          registry: () => Promise.resolve({ bytes }),
          inspect: () => ({ package: '@nest-base/core', version: '1.0.0' }),
        },
      ),
    ).rejects.toThrow('independent consumer');
  });

  it('rejects integrity mismatches and URL redirects', async () => {
    expect(
      await rejectionMessage(
        resolveArtifact(
          {
            kind: 'file',
            spec: 'C:\\fixtures\\core.tgz',
            package: '@nest-base/core',
            version: '1.0.0',
            integrity: 'sha512-invalid',
          },
          {
            file: () =>
              Promise.resolve({
                bytes,
              }),
            inspect: () => ({ package: '@nest-base/core', version: '1.0.0' }),
          },
        ),
      ),
    ).toContain('integrity');

    expect(
      await rejectionMessage(
        resolveArtifact(
          {
            kind: 'url',
            spec: 'https://example.test/core.tgz',
            package: '@nest-base/core',
            version: '1.0.0',
            integrity,
          },
          {
            url: () =>
              Promise.resolve({
                bytes,
                redirected: true,
              }),
          },
        ),
      ),
    ).toContain('redirect');
  });

  it('rejects package identity and version mismatches', async () => {
    expect(
      await rejectionMessage(
        resolveArtifact(
          {
            kind: 'registry',
            spec: '@nest-base/core@1.0.0',
            package: '@nest-base/core',
            version: '1.0.0',
            integrity,
          },
          {
            registry: () =>
              Promise.resolve({
                bytes,
              }),
            inspect: () => ({ package: '@other/package', version: '1.0.0' }),
          },
        ),
      ),
    ).toContain('identity');
  });
});
