import { createHash } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import { resolveArtifact } from '../../../packages/create-nest-base/artifact-gate';
import type { ArtifactRecord } from '../../../packages/create-nest-base/artifact-gate';
import {
  CAPABILITY_REGISTRY,
  createRegistryArtifactLoader,
  inspectPackedArtifact,
  resolveCapabilities,
  resolveSource,
  assertHttpCoreReleaseEvidence,
  bindHttpCoreReleaseEvidence,
  createHttpCoreReleaseEvidence,
  createHttpCoreReleaseEvidenceForTest,
} from '../../../packages/create-nest-base/registry';
import type { HttpCoreReleaseEvidence } from '../../../packages/create-nest-base/types';

describe('create-nest-base capability registry', () => {
  it('keeps CRUD locked, exposes logger, and explains every future capability', async () => {
    expect(CAPABILITY_REGISTRY.map((entry) => entry.id)).toEqual([
      'core-crud',
      'logger',
      'http-core',
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

    const httpCore = CAPABILITY_REGISTRY.find(
      (entry) => entry.id === 'http-core',
    );
    expect(httpCore?.status).toBe('available');
    expect(httpCore?.requiredness).toBe('optional');
    expect(httpCore?.recommended).toBe(true);
    expect(httpCore?.defaultSelectedInteractive).toBe(true);
    expect(httpCore?.package).toBe('@nest-base/http-core');
    expect(httpCore?.defaultVersion).toBe('0.1.0');
    expect(httpCore?.defaultSource).toEqual({
      kind: 'registry',
      spec: '@nest-base/http-core@0.1.0',
    });
    expect(httpCore?.defaultIntegrity).toBeUndefined();
    expect(httpCore?.compatibility).toContain('NestJS 11');
    const evidence = await createReleaseEvidence();
    expect(assertHttpCoreReleaseEvidence(evidence)).toEqual(evidence);

    for (const entry of CAPABILITY_REGISTRY.slice(3)) {
      expect(entry.status).toBe('unavailable');
      expect(entry.unavailableReason).toBeTruthy();
      expect(entry.compatibility).toBeTruthy();
      expect(entry.dependencySection).toBeTruthy();
      expect(entry.ownedPaths.length).toBeGreaterThan(0);
      expect(entry.conflicts.length).toBeGreaterThan(0);
      expect(entry.manualSteps.length).toBeGreaterThan(0);
    }
  });

  it('blocks stale, tampered, and self-attested HTTP-core release evidence', async () => {
    const evidence = await createReleaseEvidence();
    expect(bindHttpCoreReleaseEvidence(evidence)).toEqual(evidence);
    expect(() =>
      bindHttpCoreReleaseEvidence({ ...evidence, version: '0.1.1' }),
    ).toThrow('independently bound');
    expect(() =>
      bindHttpCoreReleaseEvidence({
        ...evidence,
        consumer: {
          ...evidence.consumer,
          modes: [
            'esm',
          ] as unknown as HttpCoreReleaseEvidence['consumer']['modes'],
        },
      }),
    ).toThrow('independently bound');
    expect(() =>
      bindHttpCoreReleaseEvidence({
        ...evidence,
        audit: { ...evidence.audit, artifactDigest: 'sha512-A' },
      }),
    ).toThrow('independently bound');
    expect(() =>
      bindHttpCoreReleaseEvidence({
        ...evidence,
        audit: {
          ...evidence.audit,
          tool: 'false' as unknown as HttpCoreReleaseEvidence['audit']['tool'],
        },
      }),
    ).toThrow('independently bound');
    expect(() =>
      assertHttpCoreReleaseEvidence({
        ...evidence,
        evidenceDigest: evidence.evidenceDigest,
      }),
    ).toThrow('independently bound');
  });

  it('fails closed when registry metadata or bytes are stale or tampered', async () => {
    const releaseBytes = await gzipTarball({
      name: '@nest-base/http-core',
      version: '0.1.0',
    });
    const coreArtifact = {
      bytes: await gzipTarball({ name: '@nest-base/core', version: '0.1.0' }),
    };
    const makeFetcher =
      (metadataIntegrity: string, bytes = releaseBytes) =>
      (input: RequestInfo | URL) => {
        const url = String(input);
        const coreBytes = coreArtifact.bytes;
        const coreIntegrity = `sha512-${createHash('sha512').update(coreBytes).digest('base64')}`;
        if (url.includes('%40nest-base%2Fcore'))
          return Promise.resolve(
            Response.json({
              versions: {
                '0.1.0': {
                  name: '@nest-base/core',
                  version: '0.1.0',
                  dist: {
                    tarball:
                      'https://registry.npmjs.org/@nest-base/core/-/core-0.1.0.tgz',
                    integrity: coreIntegrity,
                  },
                },
              },
            }),
          );
        if (url.endsWith('/core-0.1.0.tgz'))
          return Promise.resolve(
            new Response(new Blob([coreBytes as unknown as BlobPart])),
          );
        if (url.includes('%40nest-base%2Fhttp-core'))
          return Promise.resolve(
            Response.json({
              versions: {
                '0.1.0': {
                  name: '@nest-base/http-core',
                  version: '0.1.0',
                  dist: {
                    tarball:
                      'https://registry.npmjs.org/@nest-base/http-core/-/http-core-0.1.0.tgz',
                    integrity: metadataIntegrity,
                  },
                },
              },
            }),
          );
        return Promise.resolve(
          new Response(new Blob([bytes as unknown as BlobPart])),
        );
      };
    const integrity = `sha512-${createHash('sha512').update(releaseBytes).digest('base64')}`;
    const gate = { verify: () => Promise.resolve() };
    await expectRejected(
      createHttpCoreReleaseEvidenceForTest({
        registry: makeFetcher('sha512-A'),
        coreArtifact,
        independentConsumerGate: gate,
      }),
      'integrity',
    );
    await expectRejected(
      createHttpCoreReleaseEvidenceForTest({
        registry: makeFetcher(integrity, new Uint8Array([1, 2, 3])),
        coreArtifact,
        independentConsumerGate: gate,
      }),
      'digest',
    );
  });

  it('rejects arbitrary same-identity core bytes', async () => {
    const releaseBytes = await gzipTarball({
      name: '@nest-base/http-core',
      version: '0.1.0',
    });
    const canonicalCore = await gzipTarball({
      name: '@nest-base/core',
      version: '0.1.0',
    });
    const arbitraryCore = await gzipTarball({
      name: '@nest-base/core',
      version: '0.1.0',
      forged: 'true',
    });
    const fetcher = (input: RequestInfo | URL) => {
      const url = String(input);
      const isCore =
        url.includes('%40nest-base%2Fcore') || url.endsWith('/core-0.1.0.tgz');
      const bytes = isCore ? canonicalCore : releaseBytes;
      if (url.includes('%40nest-base%2F'))
        return Promise.resolve(
          Response.json({
            versions: {
              '0.1.0': {
                name: isCore ? '@nest-base/core' : '@nest-base/http-core',
                version: '0.1.0',
                dist: {
                  tarball: isCore
                    ? 'https://registry.npmjs.org/@nest-base/core/-/core-0.1.0.tgz'
                    : 'https://registry.npmjs.org/@nest-base/http-core/-/http-core-0.1.0.tgz',
                  integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
                },
              },
            },
          }),
        );
      return Promise.resolve(
        new Response(new Blob([bytes as unknown as BlobPart])),
      );
    };

    await expectRejected(
      createHttpCoreReleaseEvidenceForTest({
        registry: fetcher,
        coreArtifact: { bytes: arbitraryCore },
        independentConsumerGate: { verify: () => Promise.resolve() },
      }),
      'integrity/provenance',
    );
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

  it('does not allow production evidence overrides to forge accepted evidence', async () => {
    const fakeCore = {
      bytes: await gzipTarball({
        name: '@nest-base/core',
        version: '0.1.0',
      }),
    };

    await expectRejected(
      createHttpCoreReleaseEvidence({
        coreArtifact: fakeCore,
        registry: (() => Promise.reject(new Error('forged registry'))) as never,
        inspect: (() => ({
          package: '@nest-base/core',
          version: '0.1.0',
        })) as never,
        independentConsumerGate: { verify: () => Promise.resolve() } as never,
      } as never),
      'integrity',
    );
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

async function createReleaseEvidence() {
  const httpBytes = await gzipTarball({
    name: '@nest-base/http-core',
    version: '0.1.0',
  });
  const coreArtifact: ArtifactRecord = {
    bytes: await gzipTarball({ name: '@nest-base/core', version: '0.1.0' }),
  };
  const integrity = `sha512-${createHash('sha512').update(httpBytes).digest('base64')}`;
  const fetcher = (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('%40nest-base%2Fcore'))
      return Promise.resolve(
        Response.json({
          versions: {
            '0.1.0': {
              name: '@nest-base/core',
              version: '0.1.0',
              dist: {
                tarball:
                  'https://registry.npmjs.org/@nest-base/core/-/core-0.1.0.tgz',
                integrity: `sha512-${createHash('sha512').update(coreArtifact.bytes).digest('base64')}`,
              },
            },
          },
        }),
      );
    if (url.endsWith('/core-0.1.0.tgz'))
      return Promise.resolve(
        new Response(new Blob([coreArtifact.bytes as unknown as BlobPart])),
      );
    if (url.includes('%40nest-base%2Fhttp-core'))
      return Promise.resolve(
        Response.json({
          versions: {
            '0.1.0': {
              name: '@nest-base/http-core',
              version: '0.1.0',
              dist: {
                tarball:
                  'https://registry.npmjs.org/@nest-base/http-core/-/http-core-0.1.0.tgz',
                integrity,
              },
            },
          },
        }),
      );
    return Promise.resolve(
      new Response(new Blob([httpBytes as unknown as BlobPart])),
    );
  };
  return createHttpCoreReleaseEvidenceForTest({
    registry: fetcher,
    coreArtifact,
    independentConsumerGate: { verify: () => Promise.resolve() },
  });
}

async function expectRejected(
  promise: Promise<unknown>,
  message: string,
): Promise<void> {
  await promise.then(
    () => {
      throw new Error('Expected rejection.');
    },
    (error: unknown) => {
      expect(error instanceof Error ? error.message : String(error)).toContain(
        message,
      );
    },
  );
}

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
