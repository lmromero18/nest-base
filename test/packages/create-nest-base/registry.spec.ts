import { createHash } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import { resolveArtifact } from '../../../packages/create-nest-base/artifact-gate';
import {
  CAPABILITY_REGISTRY,
  createRegistryArtifactLoader,
  inspectPackedArtifact,
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
    expect(core.package).toBe('@nest-base/core');
    expect(core.defaultVersion).toBe('0.1.0');

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

  it('loads and inspects the exact registry tarball without following redirects', async () => {
    const tarball = await gzipTarball({
      name: '@nest-base/core',
      version: '0.1.0',
    });
    const calls: Array<{ url: string; redirect: RequestRedirect }> = [];
    const loader = createRegistryArtifactLoader((input, init) => {
      const url = String(input);
      calls.push({ url, redirect: init?.redirect ?? 'follow' });
      if (url === 'https://registry.npmjs.org/%40nest-base%2Fcore')
        return Promise.resolve(
          Response.json({
            name: '@nest-base/core',
            versions: {
              '0.1.0': {
                name: '@nest-base/core',
                version: '0.1.0',
                dist: {
                  tarball:
                    'https://registry.npmjs.org/@nest-base/core/-/core-0.1.0.tgz',
                },
              },
            },
          }),
        );
      if (url === 'https://registry.npmjs.org/@nest-base/core/-/core-0.1.0.tgz')
        return Promise.resolve(new Response(new Uint8Array(tarball)));
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const artifact = await loader('@nest-base/core@0.1.0');
    if (!artifact) throw new Error('Mock registry artifact was unavailable.');

    expect(artifact?.bytes).toEqual(tarball);
    expect(inspectPackedArtifact(artifact)).toEqual({
      package: '@nest-base/core',
      version: '0.1.0',
    });
    const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
    expect(
      resolveArtifact(
        {
          kind: 'registry',
          spec: '@nest-base/core@0.1.0',
          package: '@nest-base/core',
          version: '0.1.0',
          integrity,
        },
        { registry: loader, inspect: inspectPackedArtifact },
        { verify: () => Promise.resolve() },
      ),
    ).resolves.toEqual(artifact);
    expect(calls).toEqual([
      {
        url: 'https://registry.npmjs.org/%40nest-base%2Fcore',
        redirect: 'manual',
      },
      {
        url: 'https://registry.npmjs.org/@nest-base/core/-/core-0.1.0.tgz',
        redirect: 'manual',
      },
      {
        url: 'https://registry.npmjs.org/%40nest-base%2Fcore',
        redirect: 'manual',
      },
      {
        url: 'https://registry.npmjs.org/@nest-base/core/-/core-0.1.0.tgz',
        redirect: 'manual',
      },
    ]);
  });

  it('returns a redirected artifact marker so the existing gate rejects it', async () => {
    const loader = createRegistryArtifactLoader(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.test' },
        }),
      ),
    );

    const artifact = await loader('@nest-base/core@0.1.0');

    expect(artifact?.redirected).toBe(true);
  });
});

async function gzipTarball(
  packageJson: Record<string, string>,
): Promise<Uint8Array> {
  const content = new TextEncoder().encode(JSON.stringify(packageJson));
  const header = new Uint8Array(512);
  header.set(new TextEncoder().encode('package/package.json'));
  header.set(
    new TextEncoder().encode(
      `${content.length.toString(8).padStart(11, '0')}\0`,
    ),
    124,
  );
  header[156] = '0'.charCodeAt(0);
  header.fill(32, 148, 156);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.set(
    new TextEncoder().encode(`${checksum.toString(8).padStart(6, '0')}\0 `),
    148,
  );
  const tar = new Uint8Array(1024 + Math.ceil(content.length / 512) * 512);
  tar.set(header);
  tar.set(content, 512);
  const stream = new Blob([tar.buffer])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
