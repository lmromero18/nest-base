import { randomUUID } from 'node:crypto';

export interface PublisherFileSystem {
  readFile(path: string): Uint8Array;
  exists(path: string): boolean;
  mkdir(path: string): void;
  write(path: string, bytes: Uint8Array): void;
  writeAtomic(path: string, bytes: Uint8Array): void;
  replaceIfMatches(
    path: string,
    stagedPath: string,
    expected: { hash: string; bytes: Uint8Array },
  ): void;
  replaceIfAbsent(path: string, stagedPath: string): void;
  remove(path: string): void;
  removeIfMatches(path: string, expected: Uint8Array): void;
  removeEmptyDir?(path: string): void;
}

export interface ContentHasher {
  sha256(bytes: Uint8Array): string;
}

export interface PublicationFile {
  path: string;
  bytes: Uint8Array;
  expectedExists?: boolean;
  expectedHash?: string;
}

export interface PublicationRoot {
  originalBytes: Uint8Array;
  candidateBytes: Uint8Array;
  originalHash: string;
  path: string;
}

export interface PublicationPlan {
  generated: readonly PublicationFile[];
  roots: readonly PublicationRoot[];
}

export interface PublicationReport {
  status: 'published';
  generated: readonly string[];
  roots: readonly string[];
}

export class RegistrationPublicationError extends Error {
  constructor(
    readonly primary: Error,
    readonly rollback: readonly string[],
    readonly cleanup: readonly string[],
  ) {
    super(
      `Registration publication failed: ${primary.message}` +
        (rollback.length ? ` Rollback failed: ${rollback.join('; ')}` : '') +
        (cleanup.length ? ` Cleanup failed: ${cleanup.join('; ')}` : ''),
    );
    this.name = 'RegistrationPublicationError';
  }
}

export class RegistrationPublisher {
  constructor(
    private readonly fileSystem: PublisherFileSystem,
    private readonly hasher: ContentHasher,
  ) {}

  publish(plan: PublicationPlan): PublicationReport {
    const token = `registration-${randomUUID()}`;
    const staged: Array<{ target: string; path: string }> = [];
    const createdDirectories: string[] = [];
    const backups: Array<{ target: string; path: string }> = [];
    const journal: Array<{
      target: string;
      generated: boolean;
      bytes?: Uint8Array;
      publishedBytes?: Uint8Array;
    }> = [];
    let primary: Error | undefined;

    try {
      for (const file of plan.generated) {
        this.assertGeneratedOwnership(file, 'preflight');
      }
      for (const file of plan.generated) {
        this.stage(file, token, staged, createdDirectories);
      }
      for (const root of plan.roots) {
        if (!this.fileSystem.exists(root.path)) {
          throw new Error(`Registration root is missing: ${root.path}`);
        }
        this.stage(
          { path: root.path, bytes: root.candidateBytes },
          token,
          staged,
          createdDirectories,
        );
        const backup = `${root.path}.${token}.bak`;
        this.fileSystem.writeAtomic(
          backup,
          encodeRegistrationBackup(root.originalBytes, this.hasher),
        );
        backups.push({ target: root.path, path: backup });
      }

      for (const root of plan.roots) this.assertRootOwnership(root);

      for (const item of staged) {
        const generated = plan.generated.some(
          ({ path }) => path === item.target,
        );
        const generatedFile = plan.generated.find(
          ({ path }) => path === item.target,
        );
        if (generatedFile)
          this.assertGeneratedOwnership(generatedFile, 'publication');
        const root = plan.roots.find(({ path }) => path === item.target);
        if (root) this.assertRootOwnership(root);
        if (!generated || !generatedFile!.expectedExists) {
          journal.push({
            target: item.target,
            generated,
            bytes: root?.originalBytes ?? generatedFile?.bytes,
            publishedBytes: root?.candidateBytes ?? generatedFile?.bytes,
          });
        }
        if (generated) {
          if (generatedFile!.expectedExists) {
            this.fileSystem.remove(item.path);
          } else {
            this.fileSystem.replaceIfAbsent(item.target, item.path);
          }
        } else {
          this.fileSystem.replaceIfMatches(item.target, item.path, {
            hash: root!.originalHash,
            bytes: root!.originalBytes,
          });
        }
      }
    } catch (error) {
      primary = asError(error);
    }

    let rollback = primary ? this.rollback(journal, token) : [];
    let cleanup = this.cleanup(
      [...staged.map(({ path }) => path), ...backups.map(({ path }) => path)],
      primary ? createdDirectories : [],
    );
    if (!primary && cleanup.length) {
      rollback = this.rollback(journal, token);
      cleanup = [
        ...cleanup,
        ...this.cleanup(
          [
            ...staged.map(({ path }) => path),
            ...backups.map(({ path }) => path),
          ],
          createdDirectories,
        ),
      ];
    }
    if (primary || cleanup.length) {
      throw new RegistrationPublicationError(
        primary ??
          new Error('Registration publication completed but cleanup failed'),
        rollback,
        cleanup,
      );
    }
    return {
      status: 'published',
      generated: plan.generated.map(({ path }) => path),
      roots: plan.roots.map(({ path }) => path),
    };
  }

  private stage(
    file: PublicationFile,
    token: string,
    staged: Array<{ target: string; path: string }>,
    createdDirectories: string[],
  ): void {
    const path = `${file.path}.${token}.tmp`;
    const parent = parentPath(path);
    for (const directory of missingDirectories(parent, this.fileSystem)) {
      this.fileSystem.mkdir(directory);
      createdDirectories.push(directory);
    }
    this.fileSystem.write(path, file.bytes);
    staged.push({ target: file.path, path });
  }

  private assertGeneratedOwnership(
    file: PublicationFile,
    phase: 'preflight' | 'publication',
  ): void {
    const exists = this.fileSystem.exists(file.path);
    const expectedExists = file.expectedExists ?? false;
    if (exists !== expectedExists) {
      if (
        phase === 'preflight' &&
        exists &&
        !expectedExists &&
        !file.expectedHash
      ) {
        throw new Error(`Generated destination already exists: ${file.path}`);
      }
      throw new Error(
        `Generated destination changed before ${phase}: ${file.path}`,
      );
    }
    if (exists && file.expectedHash) {
      if (
        this.hasher.sha256(this.fileSystem.readFile(file.path)) !==
        file.expectedHash
      ) {
        throw new Error(
          `Generated destination changed before ${phase}: ${file.path}`,
        );
      }
    }
  }

  private assertRootOwnership(root: PublicationRoot): void {
    if (!this.fileSystem.exists(root.path)) {
      throw new Error(
        `Registration root is missing before publication: ${root.path}`,
      );
    }
    const current = this.fileSystem.readFile(root.path);
    if (
      this.hasher.sha256(current) !== root.originalHash ||
      !sameBytes(current, root.originalBytes)
    ) {
      throw new Error(
        `Registration root changed before publication: ${root.path} (hash race)`,
      );
    }
  }

  private rollback(
    journal: readonly {
      target: string;
      generated: boolean;
      bytes?: Uint8Array;
      publishedBytes?: Uint8Array;
    }[],
    token: string,
  ): string[] {
    const errors: string[] = [];
    for (const item of [...journal].reverse()) {
      try {
        if (item.generated) {
          if (!item.publishedBytes)
            throw new Error('generated ownership bytes unavailable');
          if (!this.ownsPublishedBytes(item.target, item.publishedBytes)) {
            throw new Error(
              'generated destination is no longer owned by this run',
            );
          }
          this.fileSystem.removeIfMatches(item.target, item.publishedBytes);
        } else if (item.bytes) {
          if (
            !item.publishedBytes ||
            !this.ownsPublishedBytes(item.target, item.publishedBytes)
          ) {
            throw new Error('registration root is no longer owned by this run');
          }
          const restore = `${item.target}.${token}.rollback.tmp`;
          this.fileSystem.write(restore, item.bytes);
          this.fileSystem.replaceIfMatches(item.target, restore, {
            hash: this.hasher.sha256(item.publishedBytes),
            bytes: item.publishedBytes,
          });
          this.fileSystem.remove(restore);
        }
      } catch (error) {
        errors.push(`${item.target}: ${asError(error).message}`);
      }
    }
    return errors;
  }

  private cleanup(
    paths: readonly string[],
    directories: readonly string[],
  ): string[] {
    const errors: string[] = [];
    for (const path of paths) {
      try {
        this.fileSystem.remove(path);
      } catch (error) {
        errors.push(`${path}: ${asError(error).message}`);
      }
    }
    if (this.fileSystem.removeEmptyDir) {
      for (const path of [...directories].reverse()) {
        try {
          this.fileSystem.removeEmptyDir(path);
        } catch (error) {
          errors.push(`${path}: ${asError(error).message}`);
        }
      }
    }
    return errors;
  }

  private ownsPublishedBytes(path: string, bytes: Uint8Array): boolean {
    try {
      return (
        this.hasher.sha256(this.fileSystem.readFile(path)) ===
        this.hasher.sha256(bytes)
      );
    } catch {
      return false;
    }
  }
}

export function encodeRegistrationBackup(
  bytes: Uint8Array,
  hasher: ContentHasher,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      length: bytes.length,
      sha256: hasher.sha256(bytes),
      bytes: Buffer.from(bytes).toString('base64'),
    }),
  );
}

export function decodeRegistrationBackup(
  bytes: Uint8Array,
  hasher: ContentHasher,
): Uint8Array | undefined {
  try {
    const metadata: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      typeof metadata !== 'object' ||
      metadata === null ||
      (metadata as { version?: unknown }).version !== 1 ||
      typeof (metadata as { length?: unknown }).length !== 'number' ||
      typeof (metadata as { sha256?: unknown }).sha256 !== 'string' ||
      typeof (metadata as { bytes?: unknown }).bytes !== 'string'
    ) {
      return undefined;
    }
    const decoded = new Uint8Array(
      Buffer.from((metadata as { bytes: string }).bytes, 'base64'),
    );
    if (
      decoded.length !== (metadata as { length: number }).length ||
      hasher.sha256(decoded) !== (metadata as { sha256: string }).sha256
    ) {
      return undefined;
    }
    return decoded;
  } catch {
    return undefined;
  }
}

function parentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '.' : path.slice(0, index);
}

function missingDirectories(
  path: string,
  fileSystem: Pick<PublisherFileSystem, 'exists'>,
): string[] {
  const missing: string[] = [];
  let current = path;
  while (current !== '.' && !fileSystem.exists(current)) {
    missing.push(current);
    current = parentPath(current);
  }
  return missing.reverse();
}

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('unknown publication failure');
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}
