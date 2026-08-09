import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  RegistrationPublicationError,
  RegistrationPublisher,
  type PublicationPlan,
  type PublisherFileSystem,
} from '../../../tools/module-generator/publisher';

class FakeFileSystem implements PublisherFileSystem {
  files = new Map<string, Uint8Array>();
  directories = new Set<string>();
  calls: string[] = [];
  failReplaceAt?: number;
  mutateThenFailAt?: number;
  failRemove = false;
  failCleanupRemove = false;
  racePath?: string;
  private existsChecks = new Map<string, number>();
  private replacements = 0;

  readFile(path: string): Uint8Array {
    const value = this.files.get(path);
    if (!value) throw new Error(`missing ${path}`);
    return value.slice();
  }
  exists(path: string): boolean {
    const checks = (this.existsChecks.get(path) ?? 0) + 1;
    this.existsChecks.set(path, checks);
    if (path === this.racePath && checks === 2)
      this.files.set(path, bytes('other process'));
    return this.files.has(path) || this.directories.has(path);
  }
  mkdir(path: string): void {
    this.calls.push(`mkdir:${path}`);
    this.directories.add(path);
  }
  write(path: string, bytes: Uint8Array): void {
    this.calls.push(`write:${path}`);
    this.files.set(path, bytes.slice());
  }
  writeAtomic(path: string, bytes: Uint8Array): void {
    this.calls.push(`atomic-write:${path}`);
    this.files.set(path, bytes.slice());
  }
  replaceIfMatches(
    path: string,
    stagedPath: string,
    expected: { hash: string; bytes: Uint8Array },
  ): void {
    this.calls.push(`replace:${path}`);
    this.replacements += 1;
    if (this.failReplaceAt === this.replacements)
      throw new Error('replace failed');
    const current = this.readFile(path);
    if (
      !current.every((byte, index) => byte === expected.bytes[index]) ||
      current.length !== expected.bytes.length
    )
      throw new Error('file changed before replacement');
    this.files.set(path, this.readFile(stagedPath));
    if (this.mutateThenFailAt === this.replacements)
      throw new Error('replace failed after mutation');
  }
  replaceIfAbsent(path: string, stagedPath: string): void {
    this.calls.push(`replace:${path}`);
    this.replacements += 1;
    if (this.files.has(path))
      throw new Error('destination appeared during replace');
    if (this.failReplaceAt === this.replacements)
      throw new Error('replace failed');
    this.files.set(path, this.readFile(stagedPath));
    this.files.delete(stagedPath);
  }
  remove(path: string): void {
    this.calls.push(`remove:${path}`);
    if (
      this.failRemove ||
      (this.failCleanupRemove && path.includes('.registration-'))
    ) {
      throw new Error('cleanup failed');
    }
    this.files.delete(path);
  }
  removeIfMatches(path: string, expected: Uint8Array): void {
    this.calls.push(`remove:${path}`);
    const actual = this.readFile(path);
    if (!actual.every((byte, index) => byte === expected[index]))
      throw new Error('file changed before removal');
    this.files.delete(path);
  }
  removeEmptyDir(path: string): void {
    this.calls.push(`rmdir:${path}`);
    if ([...this.files.keys()].some((file) => file.startsWith(`${path}/`)))
      throw new Error('directory is not empty');
    this.directories.delete(path);
  }
}

const bytes = (value: string) => new TextEncoder().encode(value);
const hash = (value: Uint8Array) =>
  createHash('sha256').update(value).digest('hex');

function publication(fs: FakeFileSystem): PublicationPlan {
  const app = bytes('original app');
  const data = bytes('original data');
  fs.files.set('src/app.module.ts', app);
  fs.files.set('src/config/database/data-source.ts', data);
  fs.directories.add('src');
  fs.directories.add('src/config');
  fs.directories.add('src/config/database');
  fs.directories.add('src/modules');
  fs.directories.add('test');
  fs.directories.add('test/modules');
  return {
    generated: [
      'src/modules/producto/producto.module.ts',
      'src/modules/producto/producto.controller.ts',
      'src/modules/producto/producto.service.ts',
      'src/modules/producto/producto.entity.ts',
      'src/modules/producto/dto/create-producto.dto.ts',
      'src/modules/producto/dto/update-producto.dto.ts',
      'test/modules/producto/producto.service.spec.ts',
    ].map((path) => ({ path, bytes: bytes(path) })),
    roots: [
      {
        path: 'src/app.module.ts',
        originalBytes: app,
        candidateBytes: bytes('candidate app'),
        originalHash: hash(app),
      },
      {
        path: 'src/config/database/data-source.ts',
        originalBytes: data,
        candidateBytes: bytes('candidate data'),
        originalHash: hash(data),
      },
    ],
  };
}

describe('registration publisher', () => {
  it('stages and publishes generated output and both roots', () => {
    const fs = new FakeFileSystem();
    const plan = publication(fs);
    new RegistrationPublisher(fs, { sha256: hash }).publish(plan);

    expect(new TextDecoder().decode(fs.files.get('src/app.module.ts'))).toBe(
      'candidate app',
    );
    expect(
      new TextDecoder().decode(
        fs.files.get('src/config/database/data-source.ts'),
      ),
    ).toBe('candidate data');
    for (const file of plan.generated) {
      expect(fs.files.get(file.path)).toEqual(file.bytes);
    }
    expect(
      [...fs.files.keys()].some((path) => path.includes('.registration-')),
    ).toBe(false);
  });

  it('refuses a generated collision before staging', () => {
    const fs = new FakeFileSystem();
    const plan = publication(fs);
    fs.files.set(plan.generated[3].path, bytes('pre-existing'));
    expect(() =>
      new RegistrationPublisher(fs, { sha256: hash }).publish(plan),
    ).toThrow(/generated destination already exists/i);
    expect(fs.files.get(plan.generated[3].path)).toEqual(bytes('pre-existing'));
    expect(fs.calls.some((call) => call.startsWith('replace:'))).toBe(false);
  });

  it('accepts a generated destination when its bytes already match', () => {
    const fs = new FakeFileSystem();
    const plan = publication(fs);
    fs.files.set(plan.generated[0].path, plan.generated[0].bytes);
    plan.generated[0].expectedExists = true;
    plan.generated[0].expectedHash = hash(plan.generated[0].bytes);

    new RegistrationPublisher(fs, { sha256: hash }).publish(plan);

    expect(fs.files.get(plan.generated[0].path)).toEqual(
      plan.generated[0].bytes,
    );
  });

  it('preserves a pre-existing matching generated file after a later failure', () => {
    const fs = new FakeFileSystem();
    const plan = publication(fs);
    const existing = plan.generated[0];
    fs.files.set(existing.path, existing.bytes);
    existing.expectedExists = true;
    existing.expectedHash = hash(existing.bytes);
    fs.failReplaceAt = 6;

    expect(() =>
      new RegistrationPublisher(fs, { sha256: hash }).publish(plan),
    ).toThrow(RegistrationPublicationError);

    expect(fs.files.get(existing.path)).toEqual(existing.bytes);
  });

  it('restores roots and removes only this run output after a mid-publication failure', () => {
    const fs = new FakeFileSystem();
    const plan = publication(fs);
    fs.failReplaceAt = 3;
    expect(() =>
      new RegistrationPublisher(fs, { sha256: hash }).publish(plan),
    ).toThrow(RegistrationPublicationError);
    expect(fs.calls).toContain(
      'remove:src/modules/producto/producto.module.ts',
    );
    expect(new TextDecoder().decode(fs.files.get('src/app.module.ts'))).toBe(
      'original app',
    );
    expect(
      new TextDecoder().decode(
        fs.files.get('src/config/database/data-source.ts'),
      ),
    ).toBe('original data');
    for (const file of plan.generated) {
      expect(fs.files.has(file.path)).toBe(false);
    }
    expect(fs.files.get('src/app.module.ts')).toEqual(bytes('original app'));
    expect(fs.files.get('src/config/database/data-source.ts')).toEqual(
      bytes('original data'),
    );
    expect(fs.directories.has('src/modules/producto')).toBe(false);
    expect(fs.directories.has('src/modules/producto/dto')).toBe(false);
    expect(fs.directories.has('test/modules/producto')).toBe(false);
  });

  it('reports an injected hasher failure without publishing', () => {
    const fs = new FakeFileSystem();
    const plan = publication(fs);
    let calls = 0;
    expect(() =>
      new RegistrationPublisher(fs, {
        sha256: (value) => {
          calls += 1;
          if (calls === 2) throw new Error('hasher failed');
          return hash(value);
        },
      }).publish(plan),
    ).toThrow(/hasher failed/);
    expect(fs.calls.some((call) => call.startsWith('replace:'))).toBe(false);
  });

  it('refuses a root hash race before replacement', () => {
    const fs = new FakeFileSystem();
    const plan = publication(fs);
    fs.files.set('src/app.module.ts', bytes('raced'));
    expect(() =>
      new RegistrationPublisher(fs, { sha256: hash }).publish(plan),
    ).toThrow(/hash/i);
    expect(fs.calls.some((call) => call.startsWith('replace:'))).toBe(false);
  });

  it('refuses a generated destination that appears after preflight without overwriting it', () => {
    const fs = new FakeFileSystem();
    const plan = publication(fs);
    fs.racePath = plan.generated[0].path;
    expect(() =>
      new RegistrationPublisher(fs, { sha256: hash }).publish(plan),
    ).toThrow(/generated destination changed/i);
    expect(fs.files.get(fs.racePath)).toEqual(bytes('other process'));
    expect(fs.files.get('src/app.module.ts')).toEqual(bytes('original app'));
    expect(fs.files.get('src/config/database/data-source.ts')).toEqual(
      bytes('original data'),
    );
  });

  it('reports cleanup diagnostics separately from the primary failure', () => {
    const fs = new FakeFileSystem();
    fs.failReplaceAt = 2;
    fs.failCleanupRemove = true;
    try {
      new RegistrationPublisher(fs, { sha256: hash }).publish(publication(fs));
      throw new Error('expected publication failure');
    } catch (error) {
      expect(error).toBeInstanceOf(RegistrationPublicationError);
      expect((error as RegistrationPublicationError).primary.message).toContain(
        'replace failed',
      );
      expect(
        (error as RegistrationPublicationError).cleanup.length,
      ).toBeGreaterThan(0);
    }
  });

  it('restores roots when replacement mutates and then fails', () => {
    const fs = new FakeFileSystem();
    fs.mutateThenFailAt = 8;
    expect(() =>
      new RegistrationPublisher(fs, { sha256: hash }).publish(publication(fs)),
    ).toThrow(RegistrationPublicationError);
    expect(fs.files.get('src/app.module.ts')).toEqual(bytes('original app'));
    expect(fs.files.get('src/config/database/data-source.ts')).toEqual(
      bytes('original data'),
    );
    expect(fs.files.has('src/modules/producto/producto.module.ts')).toBe(false);
  });

  it('rolls back published bytes when cleanup itself fails', () => {
    const fs = new FakeFileSystem();
    fs.failCleanupRemove = true;
    expect(() =>
      new RegistrationPublisher(fs, { sha256: hash }).publish(publication(fs)),
    ).toThrow(RegistrationPublicationError);
    expect(fs.calls).toContain(
      'remove:src/modules/producto/producto.module.ts',
    );
    expect(new TextDecoder().decode(fs.files.get('src/app.module.ts'))).toBe(
      'original app',
    );
    expect(fs.files.has('src/modules/producto/producto.module.ts')).toBe(false);
  });
});
