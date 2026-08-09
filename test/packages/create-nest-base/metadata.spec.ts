import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  applyOwnedWrites,
  buildMetadataPreview,
  createMetadataFileSystem,
  rollbackOwnedWrites,
  type MetadataFileSystem,
} from '../../../packages/create-nest-base/metadata';
import type { NormalizedPlan } from '../../../packages/create-nest-base/types';

const plan: NormalizedPlan = {
  schemaVersion: 1,
  wizardVersion: '0.1.0',
  target: join(tmpdir(), 'create-nest-base-metadata', 'demo'),
  registryRevision: '2026-07-27',
  capabilities: [
    {
      id: 'core-crud',
      status: 'enabled',
      package: '@nest-base/core',
      version: '1.0.0',
      source: { kind: 'registry', spec: '@nest-base/core@1.0.0' },
      integrity: `sha512-${createHash('sha512').update('core').digest('base64')}`,
    },
  ],
  dependencySections: { '@nest-base/core': 'dependencies' },
  previewOnly: false,
};

const packagePath = join(plan.target, 'package.json');
const manifestPath = join(plan.target, '.nest-base', 'manifest.json');
const loggerPath = join(plan.target, '.nest-base', 'logger.json');
const binaryPath = join(plan.target, '.nest-base', 'artifact.tgz');

function memoryFs(files: Record<string, string>): MetadataFileSystem {
  return {
    readFile: (path) => files[path],
    writeFile: (path, content) => {
      files[path] = content;
    },
    exists: (path) => path in files,
    mkdir: () => undefined,
    removeFile: (path) => delete files[path],
  };
}

describe('create-nest-base canonical metadata', () => {
  it('builds a v1 manifest and exact package mirror while preserving root keys', () => {
    const files: Record<string, string> = {
      [packagePath]: JSON.stringify({
        name: 'demo',
        scripts: { test: 'bun test' },
      }),
    };
    const preview = buildMetadataPreview(plan, memoryFs(files));
    const manifest = JSON.parse(
      preview.writes.find((write) => write.path.endsWith('manifest.json'))!
        .content,
    ) as {
      schemaVersion: number;
      resolvedEntries: unknown[];
      dependencySections: unknown;
      hashes: Record<string, string>;
    };
    const packageJson = JSON.parse(
      preview.writes.find((write) => write.path.endsWith('package.json'))!
        .content,
    ) as { scripts: unknown; nestBase: unknown };

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.resolvedEntries[0]).toMatchObject(plan.capabilities[0]);
    expect(manifest.dependencySections).toEqual({
      dependencies: { '@nest-base/core': '1.0.0' },
      devDependencies: {},
    });
    expect(manifest.hashes['package.json']).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(manifest.hashes).sort()).toEqual([
      '.nest-base/manifest.json',
      'package.json',
      'package.json.nestBase',
    ]);
    expect(manifest.hashes['.nest-base/manifest.json']).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(manifest.hashes['package.json.nestBase']).toMatch(/^[a-f0-9]{64}$/);
    expect(packageJson.scripts).toEqual({ test: 'bun test' });
    expect(packageJson.nestBase).toEqual({
      schemaVersion: 1,
      wizardVersion: '0.1.0',
      manifestPath: '.nest-base/manifest.json',
      capabilities: plan.capabilities,
    });
  });

  it('uses verified file and URL sources as the generated dependency specs', () => {
    for (const source of [
      { kind: 'file' as const, spec: '/artifacts/core.tgz' },
      { kind: 'url' as const, spec: 'https://example.test/core.tgz' },
    ]) {
      const sourcePlan: NormalizedPlan = {
        ...plan,
        capabilities: [{ ...plan.capabilities[0], source }],
      };
      const fs = memoryFs({
        [join(sourcePlan.target, 'package.json')]: JSON.stringify({
          name: 'demo',
        }),
      });

      const preview = buildMetadataPreview(sourcePlan, fs);
      const packageJson = JSON.parse(
        preview.writes.find((write) => write.path.endsWith('package.json'))!
          .content,
      ) as { dependencies: Record<string, string> };
      const manifest = JSON.parse(
        preview.writes.find((write) => write.path.endsWith('manifest.json'))!
          .content,
      ) as { resolvedEntries: typeof sourcePlan.capabilities };

      expect(packageJson.dependencies['@nest-base/core']).toBe(source.spec);
      expect(manifest.resolvedEntries[0]).toMatchObject({
        source,
        integrity: sourcePlan.capabilities[0].integrity,
      });
    }
  });

  it('pins non-registry dependencies to the verified artifact bytes', () => {
    const sourcePlan: NormalizedPlan = {
      ...plan,
      capabilities: [
        {
          ...plan.capabilities[0],
          source: { kind: 'url', spec: 'https://example.test/core.tgz' },
        },
      ],
    };
    const files: Record<string, string> = {
      [join(sourcePlan.target, 'package.json')]: JSON.stringify({
        name: 'demo',
      }),
    };
    const fs = memoryFs(files);
    const bytes = new TextEncoder().encode('verified');
    const preview = buildMetadataPreview(
      sourcePlan,
      fs,
      new Map([['core-crud', { bytes }]]),
    );
    const packageJson = JSON.parse(
      preview.writes.find((write) => write.path.endsWith('package.json'))!
        .content,
    ) as { dependencies: Record<string, string> };

    expect(packageJson.dependencies['@nest-base/core']).toMatch(
      /^\.nest-base\/artifacts\/core-crud-[a-f0-9]{64}\.tgz$/,
    );
    expect(preview.writes.some((write) => write.bytes === bytes)).toBe(true);
  });

  it('treats registry, file, and URL sources as no-op reruns', () => {
    for (const source of [
      plan.capabilities[0].source,
      { kind: 'file' as const, spec: '/artifacts/core.tgz' },
      { kind: 'url' as const, spec: 'https://example.test/core.tgz' },
    ]) {
      const sourcePlan: NormalizedPlan = {
        ...plan,
        capabilities: [{ ...plan.capabilities[0], source }],
      };
      const files: Record<string, string> = {
        [join(sourcePlan.target, 'package.json')]: JSON.stringify({
          name: 'demo',
        }),
      };
      const fs = memoryFs(files);

      applyOwnedWrites(buildMetadataPreview(sourcePlan, fs), fs);

      expect(buildMetadataPreview(sourcePlan, fs).writes).toEqual([]);
    }
  });

  it('fails closed when an existing artifact source, version, or integrity drifts', () => {
    for (const source of [
      { kind: 'file' as const, spec: '/artifacts/core.tgz' },
      { kind: 'url' as const, spec: 'https://example.test/core.tgz' },
    ]) {
      const sourcePlan: NormalizedPlan = {
        ...plan,
        capabilities: [{ ...plan.capabilities[0], source }],
      };
      const files: Record<string, string> = {
        [join(sourcePlan.target, 'package.json')]: JSON.stringify({
          name: 'demo',
        }),
      };
      const fs = memoryFs(files);
      applyOwnedWrites(buildMetadataPreview(sourcePlan, fs), fs);
      const changedIntegrity: NormalizedPlan['capabilities'][number]['integrity'] = `sha512-${createHash('sha512').update('changed').digest('base64')}`;

      for (const capabilities of [
        [
          {
            ...sourcePlan.capabilities[0],
            source: { ...source, spec: `${source.spec}?changed` },
          },
        ],
        [{ ...sourcePlan.capabilities[0], version: '2.0.0' }],
        [
          {
            ...sourcePlan.capabilities[0],
            integrity: changedIntegrity,
          },
        ],
      ]) {
        expect(() =>
          buildMetadataPreview({ ...sourcePlan, capabilities }, fs),
        ).toThrow('drift');
      }
    }
  });

  it('writes metadata paths through node path semantics', () => {
    const target = join(tmpdir(), 'nest-base-paths');
    const pathPlan = { ...plan, target };
    const fs = memoryFs({
      [join(target, 'package.json')]: JSON.stringify({ name: 'demo' }),
    });

    const preview = buildMetadataPreview(pathPlan, fs);

    expect(preview.writes.map((write) => write.path)).toContain(
      join(target, '.nest-base', 'manifest.json'),
    );
  });

  it('is verify-only for the same plan and refuses drift, unknown fields, and conflicts', () => {
    const files: Record<string, string> = {
      [packagePath]: JSON.stringify({ name: 'demo' }),
    };
    const fs = memoryFs(files);
    const first = buildMetadataPreview(plan, fs);
    applyOwnedWrites(first, fs);
    expect(buildMetadataPreview(plan, fs).writes).toEqual([]);

    files[packagePath] = JSON.stringify({ name: 'changed' });
    expect(() => buildMetadataPreview(plan, fs)).toThrow('drift');
    files[packagePath] = JSON.stringify({
      name: 'demo',
      nestBase: {
        schemaVersion: 1,
        wizardVersion: '0.1.0',
        manifestPath: '.nest-base/manifest.json',
        capabilities: [],
        extra: true,
      },
    });
    expect(() => buildMetadataPreview(plan, fs)).toThrow('unknown');
  });

  it('refuses a changed source, version, or registry revision instead of treating it as an upgrade', () => {
    const files: Record<string, string> = {
      [packagePath]: JSON.stringify({ name: 'demo' }),
    };
    const fs = memoryFs(files);
    applyOwnedWrites(buildMetadataPreview(plan, fs), fs);
    expect(() =>
      buildMetadataPreview(
        {
          ...plan,
          registryRevision: 'changed',
        },
        fs,
      ),
    ).toThrow('drift');
    expect(() =>
      buildMetadataPreview(
        {
          ...plan,
          capabilities: [{ ...plan.capabilities[0], version: '2.0.0' }],
        },
        fs,
      ),
    ).toThrow('drift');
  });

  it('refuses an existing dependency value that is not owned by the plan', () => {
    const fs = memoryFs({
      [packagePath]: JSON.stringify({
        name: 'demo',
        dependencies: { '@nest-base/core': '^1.0.0' },
      }),
    });
    expect(() => buildMetadataPreview(plan, fs)).toThrow('conflict');
  });

  it('refuses a deleted package.json between preview and apply', () => {
    const files: Record<string, string> = {
      [packagePath]: JSON.stringify({ name: 'demo' }),
    };
    const fs = memoryFs(files);
    const preview = buildMetadataPreview(plan, fs);
    delete files[packagePath];

    expect(() => applyOwnedWrites(preview, fs)).toThrow('deleted before write');
    expect(files[packagePath]).toBeUndefined();
    expect(files[manifestPath]).toBeUndefined();
  });

  it('refuses package conflicts across every dependency section', () => {
    for (const section of [
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      const fs = memoryFs({
        [packagePath]: JSON.stringify({
          name: 'demo',
          [section]: { '@nest-base/core': '1.0.0' },
        }),
      });

      expect(() => buildMetadataPreview(plan, fs)).toThrow('conflict');
    }
  });

  it('does not write during preview and rejects a race before mutation', () => {
    const files: Record<string, string> = {
      [packagePath]: JSON.stringify({ name: 'demo' }),
    };
    const fs = memoryFs(files);
    const preview = buildMetadataPreview(plan, fs);
    expect(files[manifestPath]).toBeUndefined();
    files[packagePath] = JSON.stringify({ name: 'raced' });
    expect(() => applyOwnedWrites(preview, fs)).toThrow('changed');
    expect(files[manifestPath]).toBeUndefined();
  });

  it('compensates only owned files and reports leftovers on rollback failure', () => {
    const files: Record<string, string> = {
      [packagePath]: JSON.stringify({ name: 'demo' }),
    };
    const fs = memoryFs(files);
    const preview = buildMetadataPreview(plan, fs);
    let writes = 0;
    const failingFs: MetadataFileSystem = {
      ...fs,
      writeFile: (path, content) => {
        writes += 1;
        if (writes === 2) {
          files[packagePath] = 'user changed this during rollback';
          throw new Error('disk full');
        }
        fs.writeFile(path, content);
      },
    };
    expect(() => applyOwnedWrites(preview, failingFs)).toThrow('Leftovers');
    expect(files[packagePath]).toBe('user changed this during rollback');
    expect(files[manifestPath]).toBeUndefined();
  });

  it('preserves a concurrent binary replacement during compensation', () => {
    const metadataPath = manifestPath;
    const writtenBytes = new TextEncoder().encode('wizard artifact');
    const replacementBytes = new TextEncoder().encode('user replacement');
    const bytes: Record<string, Uint8Array> = {};
    let metadataWriteStarted = false;
    const fs: MetadataFileSystem = {
      readFile: (path) => (path === metadataPath ? undefined : undefined),
      writeFile: (path) => {
        if (path !== metadataPath) return;
        bytes[binaryPath] = replacementBytes;
        metadataWriteStarted = true;
        throw new Error('disk full');
      },
      exists: (path) => path in bytes,
      mkdir: () => undefined,
      removeFile: (path) => {
        delete bytes[path];
      },
      writeBytes: (path, content) => {
        bytes[path] = content;
      },
      readBytes: (path) => bytes[path],
    };

    expect(() =>
      applyOwnedWrites(
        {
          writes: [
            { path: binaryPath, content: '', bytes: writtenBytes },
            { path: metadataPath, content: 'manifest' },
          ],
          manifest: {} as never,
          mirror: {} as never,
        },
        fs,
      ),
    ).toThrow('Leftovers');
    expect(metadataWriteStarted).toBe(true);
    expect(bytes[binaryPath]).toBe(replacementBytes);
  });

  it('preserves a binary replacement made after ownership verification', () => {
    const writtenBytes = new TextEncoder().encode('wizard artifact');
    const replacementBytes = new TextEncoder().encode('user replacement');
    const bytes: Record<string, Uint8Array> = { [binaryPath]: writtenBytes };
    let verified = false;
    const fs: MetadataFileSystem = {
      readFile: () => undefined,
      writeFile: () => undefined,
      renameFile: (path, destination) => {
        bytes[destination] = bytes[path];
        delete bytes[path];
      },
      renameFileIfAbsent: (path, destination) => {
        if (destination in bytes) throw new Error('destination exists');
        bytes[destination] = bytes[path];
        delete bytes[path];
      },
      exists: (path) => path in bytes,
      mkdir: () => undefined,
      removeFile: (path) => {
        if (path !== binaryPath) {
          bytes[binaryPath] = replacementBytes;
          verified = true;
        }
        delete bytes[path];
      },
      readBytes: (path) => {
        return bytes[path];
      },
    };

    const rollback = rollbackOwnedWrites(
      {
        writes: [{ path: binaryPath, content: '', bytes: writtenBytes }],
        manifest: {} as never,
        mirror: {} as never,
      },
      fs,
    );

    expect(verified).toBe(true);
    expect(rollback.leftovers).toEqual([]);
    expect(bytes[binaryPath]).toBe(replacementBytes);
  });

  it('restores the original path when quarantine reading fails', () => {
    const writtenBytes = new TextEncoder().encode('wizard artifact');
    const bytes: Record<string, Uint8Array> = { [binaryPath]: writtenBytes };
    const fs: MetadataFileSystem = {
      readFile: () => undefined,
      writeFile: () => undefined,
      renameFile: (path, destination) => {
        bytes[destination] = bytes[path];
        delete bytes[path];
      },
      renameFileIfAbsent: (path, destination) => {
        if (destination in bytes) throw new Error('destination exists');
        bytes[destination] = bytes[path];
        delete bytes[path];
      },
      exists: (path) => path in bytes,
      mkdir: () => undefined,
      removeFile: (path) => delete bytes[path],
      readBytes: () => undefined,
    };

    const rollback = rollbackOwnedWrites(
      {
        writes: [{ path: binaryPath, content: '', bytes: writtenBytes }],
        manifest: {} as never,
        mirror: {} as never,
      },
      fs,
    );

    expect(rollback.leftovers).toEqual([binaryPath]);
    expect(bytes[binaryPath]).toBe(writtenBytes);
    expect(Object.keys(bytes)).toEqual([binaryPath]);
  });

  it('reports the quarantine path when cleanup and restoration both fail', () => {
    const writtenBytes = new TextEncoder().encode('wizard artifact');
    const bytes: Record<string, Uint8Array> = { [binaryPath]: writtenBytes };
    const fs: MetadataFileSystem = {
      readFile: () => undefined,
      writeFile: () => undefined,
      renameFile: (path, destination) => {
        if (destination === binaryPath)
          throw new Error('original path cannot be restored');
        bytes[destination] = bytes[path];
        delete bytes[path];
      },
      renameFileIfAbsent: (path, destination) => {
        if (destination === binaryPath || destination in bytes)
          throw new Error('destination exists');
        bytes[destination] = bytes[path];
        delete bytes[path];
      },
      exists: (path) => path in bytes,
      mkdir: () => undefined,
      removeFile: (path) => {
        if (path !== binaryPath) throw new Error('quarantine cleanup failed');
        delete bytes[path];
      },
      readBytes: (path) => bytes[path],
    };

    const rollback = rollbackOwnedWrites(
      {
        writes: [{ path: binaryPath, content: '', bytes: writtenBytes }],
        manifest: {} as never,
        mirror: {} as never,
      },
      fs,
    );

    expect(rollback.leftovers).toHaveLength(1);
    expect(rollback.leftovers[0]).toContain(
      `${binaryPath}.nest-base-rollback-`,
    );
    expect(bytes[rollback.leftovers[0]]).toBe(writtenBytes);
  });

  it('preserves a destination replaced between the restore check and attempt', () => {
    const writtenBytes = new TextEncoder().encode('wizard artifact');
    const replacementBytes = new TextEncoder().encode('user replacement');
    const quarantinePathPrefix = `${binaryPath}.nest-base-rollback-`;
    const bytes: Record<string, Uint8Array> = { [binaryPath]: writtenBytes };
    let restoreCheck = false;
    const fs: MetadataFileSystem = {
      readFile: () => undefined,
      writeFile: () => undefined,
      renameFile: (path, destination) => {
        bytes[destination] = bytes[path];
        delete bytes[path];
      },
      renameFileIfAbsent: (path, destination) => {
        if (destination in bytes) throw new Error('destination exists');
        bytes[destination] = bytes[path];
        delete bytes[path];
      },
      exists: (path) => {
        if (path === binaryPath && !restoreCheck) {
          restoreCheck = true;
          bytes[binaryPath] = replacementBytes;
          return false;
        }
        return path in bytes;
      },
      mkdir: () => undefined,
      removeFile: (path) => delete bytes[path],
      readBytes: () => undefined,
    };

    const rollback = rollbackOwnedWrites(
      {
        writes: [{ path: binaryPath, content: '', bytes: writtenBytes }],
        manifest: {} as never,
        mirror: {} as never,
      },
      fs,
    );

    expect(restoreCheck).toBe(true);
    expect(rollback.leftovers).toHaveLength(1);
    expect(rollback.leftovers[0].startsWith(quarantinePathPrefix)).toBe(true);
    expect(bytes[binaryPath]).toBe(replacementBytes);
    expect(bytes[rollback.leftovers[0]]).toBe(writtenBytes);
  });

  it('re-reads each owned path at its mutation boundary and refuses an injected race', () => {
    const racePlan: NormalizedPlan = {
      ...plan,
      capabilities: [
        ...plan.capabilities,
        {
          id: 'logger',
          status: 'enabled',
          package: '@nest-base/logger',
          version: '1.0.0',
          source: { kind: 'registry', spec: '@nest-base/logger@1.0.0' },
          integrity: `sha512-${createHash('sha512').update('logger').digest('base64')}`,
        },
      ],
      dependencySections: {
        ...plan.dependencySections,
        logger: 'dependencies',
      },
    };
    const files: Record<string, string> = {
      [packagePath]: JSON.stringify({ name: 'demo' }),
      [loggerPath]: 'original logger',
    };
    const base = memoryFs(files);
    const preview = buildMetadataPreview(racePlan, base);
    const manifestWrite = preview.writes.find((write) =>
      write.path.endsWith('manifest.json'),
    );
    expect(manifestWrite).toBeDefined();
    const manifest = JSON.parse(manifestWrite!.content) as {
      ownedPaths: string[];
      hashes: Record<string, string>;
    };
    expect(Object.keys(manifest.hashes).sort()).toEqual(
      manifest.ownedPaths.slice().sort(),
    );
    let packageWrites = 0;
    const racedFs: MetadataFileSystem = {
      ...base,
      writeFile: (path, content) => {
        packageWrites += 1;
        if (packageWrites === 1) files[loggerPath] = 'raced bytes';
        base.writeFile(path, content);
      },
    };
    expect(() => applyOwnedWrites(preview, racedFs)).toThrow(
      'changed before write',
    );
    expect(files[loggerPath]).toBe('raced bytes');
  });

  it('refuses changed capability-owned output bytes recorded by the manifest', () => {
    const loggerPlan: NormalizedPlan = {
      ...plan,
      capabilities: [
        ...plan.capabilities,
        {
          id: 'logger',
          status: 'enabled',
          package: '@nest-base/logger',
          version: '1.0.0',
          source: { kind: 'registry', spec: '@nest-base/logger@1.0.0' },
          integrity: `sha512-${createHash('sha512').update('logger').digest('base64')}`,
        },
      ],
      dependencySections: {
        ...plan.dependencySections,
        logger: 'dependencies',
      },
    };
    const files: Record<string, string> = {
      [packagePath]: JSON.stringify({ name: 'demo' }),
    };
    const fs = memoryFs(files);
    applyOwnedWrites(buildMetadataPreview(loggerPlan, fs), fs);
    files[loggerPath] = 'user changed bytes';

    expect(() => buildMetadataPreview(loggerPlan, fs)).toThrow('changed');
    expect(files[loggerPath]).toBe('user changed bytes');
  });

  it('uses the real adapter to remove an owned file while preserving unrelated files', () => {
    const fileSystem = createMetadataFileSystem();
    const root = mkdtempSync(join(tmpdir(), 'nest-base-metadata-'));
    const path = join(root, '.nest-base', 'owned.json');
    fileSystem.mkdir(join(root, '.nest-base'));
    fileSystem.writeFile(path, 'owned');
    const unrelated = join(root, 'unrelated.txt');
    fileSystem.writeFile(unrelated, 'keep');
    fileSystem.removeFile(path);
    expect(fileSystem.readFile(path)).toBeUndefined();
    expect(fileSystem.readFile(unrelated)).toBe('keep');
  });

  it('reports a leftover through the real filesystem adapter during recovery', () => {
    const fileSystem = createMetadataFileSystem();
    const root = mkdtempSync(join(tmpdir(), 'nest-base-recovery-'));
    const path = join(root, 'owned.json');
    fileSystem.writeFile(path, 'new');
    fileSystem.writeFile(path, 'changed by another process');
    const rollback = rollbackOwnedWrites(
      {
        writes: [
          {
            path,
            content: 'new',
            previousContent: 'old',
            expectedSha256: undefined,
          },
        ],
        manifest: {} as never,
        mirror: {} as never,
      },
      fileSystem,
    );
    expect(rollback.leftovers).toEqual([path]);
    expect(fileSystem.readFile(path)).toBe('changed by another process');
  });
});
