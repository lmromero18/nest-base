export interface NameModel {
  moduleName: string;
  className: string;
  entityName: string;
  propertyName: string;
  tableName: string;
  route: string;
}

export interface GenerationOptions {
  dryRun: boolean;
  cwd: string;
  register?: boolean;
}

export interface PlannedFile {
  relativePath: string;
  content: string;
}

export interface GenerationPlan {
  name: NameModel;
  files: readonly PlannedFile[];
}

export interface FileSystem {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  writeFileSync(path: string, content: string, encoding: 'utf8'): void;
  readFileSync?(path: string, encoding: 'utf8'): string;
  renameSync(oldPath: string, newPath: string): void;
  rmSync(path: string, options: { force?: boolean; recursive?: boolean }): void;
  mkdtempSync(prefix: string): string;
  removeEmptyDir?(path: string): void;
}

export interface GenerationResult {
  plan: GenerationPlan;
  dryRun: boolean;
  written: boolean;
  registered?: boolean;
  registration?: import('./registration').RegistrationPlan;
}

export type FileRenderer = (relativePath: string, name: NameModel) => string;

export const STANDARD_FILE_PATHS = [
  'src/modules/<module>/<module>.module.ts',
  'src/modules/<module>/<module>.controller.ts',
  'src/modules/<module>/<module>.service.ts',
  'src/modules/<module>/<module>.entity.ts',
  'src/modules/<module>/dto/create-<module>.dto.ts',
  'src/modules/<module>/dto/update-<module>.dto.ts',
  'test/modules/<module>/<module>.service.spec.ts',
] as const;

const RESERVED_MODULE_NAMES = new Set([
  'auth',
  'health',
  'health-check',
  'login',
  'notification',
  'notifications',
  'websocket',
  'web-socket',
  'websockets',
  'web-sockets',
  'socket',
  'sockets',
]);

const MODULE_NAME_PATTERN = /^[a-z]+(?:-[a-z]+)*$/;

export class InvalidModuleNameError extends Error {
  constructor(name: string, reason: string) {
    super(
      `Invalid module name "${name}": ${reason}. Use a supported Spanish kebab-case name.`,
    );
    this.name = 'InvalidModuleNameError';
  }
}

export function getNameValidationError(name: string): string | undefined {
  if (!name || !MODULE_NAME_PATTERN.test(name)) {
    return 'module name must use lowercase kebab-case without traversal segments';
  }

  if (RESERVED_MODULE_NAMES.has(name)) {
    return 'module name is reserved for a special-purpose module';
  }

  return undefined;
}

export function deriveNameModel(name: string): NameModel {
  const reason = getNameValidationError(name);
  if (reason) {
    throw new InvalidModuleNameError(name, reason);
  }

  const words = name.split('-');
  const className = words.map((word) => capitalize(word)).join('');

  return {
    moduleName: name,
    className,
    entityName: `${className}Entity`,
    propertyName: words
      .map((word, index) => (index === 0 ? word : capitalize(word)))
      .join(''),
    tableName: `tb_${words.join('_')}`,
    route: name,
  };
}

export function createGenerationPlan(name: string): GenerationPlan {
  const model = deriveNameModel(name);

  return renderGenerationPlan(model, renderTemplate);
}

export function renderGenerationPlan(
  model: NameModel,
  renderFile: FileRenderer,
): GenerationPlan {
  return {
    name: model,
    files: STANDARD_FILE_PATHS.map((templatePath) => ({
      relativePath: templatePath.replaceAll('<module>', model.moduleName),
      content: renderFile(
        templatePath.replaceAll('<module>', model.moduleName),
        model,
      ),
    })),
  };
}

export function preflightGeneration(
  plan: GenerationPlan,
  cwd: string,
  fileSystem: Pick<FileSystem, 'existsSync'> = nodeFileSystem,
): void {
  const destinations = plan.files.map(({ relativePath }) =>
    joinPath(cwd, relativePath),
  );
  const moduleRoots = [
    joinPath(cwd, `src/modules/${plan.name.moduleName}`),
    joinPath(cwd, `test/modules/${plan.name.moduleName}`),
  ];
  const collisions = [...new Set([...destinations, ...moduleRoots])].filter(
    (path) => fileSystem.existsSync(path),
  );

  if (collisions.length > 0) {
    throw new Error(
      `Generation refused because destinations already exist:\n${collisions
        .map((path) => `  - ${path}`)
        .join('\n')}`,
    );
  }
}

export function generateModule(
  name: string,
  options: GenerationOptions,
  fileSystem: FileSystem = nodeFileSystem,
): GenerationResult {
  const plan = createGenerationPlan(name);
  if (options.register) {
    return generateRegisteredModule(plan, options);
  }
  preflightGeneration(plan, options.cwd, fileSystem);

  if (options.dryRun) {
    return { plan, dryRun: true, written: false };
  }

  const sourceParent = joinPath(options.cwd, 'src/modules');
  const testParent = joinPath(options.cwd, 'test/modules');
  let sourceStage: string | undefined;
  let testStage: string | undefined;
  const committed: string[] = [];
  let generationError: unknown;

  try {
    sourceStage = fileSystem.mkdtempSync(
      joinPath(sourceParent, `.${plan.name.moduleName}.staging-`),
    );
    testStage = fileSystem.mkdtempSync(
      joinPath(testParent, `.${plan.name.moduleName}.staging-`),
    );
    for (const file of plan.files) {
      const stageRoot = file.relativePath.startsWith('src/')
        ? sourceStage
        : testStage;
      const moduleRelativePath = file.relativePath
        .replace(/^src\/modules\//, '')
        .replace(/^test\/modules\//, '')
        .replace(`${plan.name.moduleName}/`, '');
      const target = joinPath(stageRoot, moduleRelativePath);
      fileSystem.mkdirSync(parentPath(target), { recursive: true });
      fileSystem.writeFileSync(target, file.content, 'utf8');
    }

    const destinations = [
      [sourceStage, joinPath(sourceParent, plan.name.moduleName)],
      [testStage, joinPath(testParent, plan.name.moduleName)],
    ] as const;
    for (const [stage, destination] of destinations) {
      if (fileSystem.existsSync(destination)) {
        throw new Error(
          `Generation refused because destination appeared during write: ${destination}`,
        );
      }
      fileSystem.renameSync(stage, destination);
      committed.push(destination);
    }
  } catch (error) {
    generationError = error;
  }

  const committedContent = new Map<string, string>();
  const committedFiles = committed.flatMap((destination) =>
    plan.files
      .filter(({ relativePath }) =>
        destination.includes('/src/modules/')
          ? relativePath.startsWith('src/')
          : relativePath.startsWith('test/'),
      )
      .map(({ relativePath, content }) => {
        const target = joinPath(
          destination,
          relativePath
            .replace(/^src\/modules\//, '')
            .replace(/^test\/modules\//, '')
            .replace(`${plan.name.moduleName}/`, ''),
        );
        committedContent.set(target, content);
        return target;
      }),
  );
  const committedDirectories = committed.flatMap((destination) => [
    joinPath(destination, 'dto'),
    destination,
  ]);
  const cleanupTargets = generationError
    ? [...committedFiles, sourceStage, testStage]
    : [sourceStage, testStage];
  const cleanupFailures: string[] = [];
  for (const target of cleanupTargets) {
    if (!target) continue;
    try {
      if (generationError && fileSystem.readFileSync) {
        const expected = committedContent.get(target);
        if (
          expected !== undefined &&
          fileSystem.readFileSync(target, 'utf8') !== expected
        )
          continue;
      }
      fileSystem.rmSync(target, {
        recursive: target === sourceStage || target === testStage,
        force: true,
      });
    } catch (error) {
      cleanupFailures.push(
        `${target}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  if (generationError && fileSystem.removeEmptyDir) {
    for (const target of committedDirectories) {
      try {
        fileSystem.removeEmptyDir(target);
      } catch {
        // A concurrent addition makes the directory non-empty; preserve it.
      }
    }
  } else if (generationError) {
    for (const target of committedDirectories) {
      try {
        rmdirSync(target);
      } catch {
        // A concurrent addition makes the directory non-empty; preserve it.
      }
    }
  }

  if (generationError) {
    const message =
      generationError instanceof Error
        ? generationError.message
        : 'Generation failed.';
    const cleanupMessage = cleanupFailures.length
      ? ` Cleanup failed for: ${cleanupFailures.join('; ')}`
      : ' Generated files were cleaned up.';
    throw new Error(`${message}.${cleanupMessage}`);
  }

  if (cleanupFailures.length > 0) {
    throw new Error(
      `Generation completed, but cleanup failed for: ${cleanupFailures.join('; ')}`,
    );
  }

  return { plan, dryRun: false, written: true };
}

function generateRegisteredModule(
  plan: GenerationPlan,
  options: GenerationOptions,
): GenerationResult {
  const registrationPlan = createRegistrationPlan(plan.name);
  const registrationFileSystem = createRegistrationFileSystem(options.cwd);
  const preflight = preflightRegistration(
    registrationPlan,
    registrationFileSystem,
    plan.files.map(({ relativePath, content }) => ({
      path: relativePath,
      bytes: new TextEncoder().encode(content),
    })),
  );
  if (options.dryRun || preflight.status === 'already-registered') {
    return {
      plan,
      dryRun: options.dryRun,
      written: false,
      registered: preflight.status === 'already-registered',
      registration: registrationPlan,
    };
  }

  const roots = preflight.roots.map((root, index) => {
    const target = registrationPlan.rootTargets.find(
      ({ path }) => path === root.path,
    )!;
    const snapshot = preflight.rootSnapshots[index];
    if (!snapshot)
      throw new Error(`Registration root snapshot is missing: ${root.path}`);
    return {
      path: target.path,
      originalBytes: snapshot.bytes,
      candidateBytes: new TextEncoder().encode(preflight.candidates[index]),
      originalHash: snapshot.hash,
    };
  });
  new RegistrationPublisher(registrationFileSystem, { sha256 }).publish({
    generated: plan.files.map(({ relativePath, content }) => ({
      path: relativePath,
      bytes: new TextEncoder().encode(content),
      expectedExists: preflight.existingGenerated.includes(relativePath),
      expectedHash: sha256(new TextEncoder().encode(content)),
    })),
    roots,
  });
  return {
    plan,
    dryRun: false,
    written: true,
    registered: true,
    registration: registrationPlan,
  };
}

function createRegistrationFileSystem(cwd: string): RegistrationFileSystem {
  const resolve = (path: string) => joinPath(cwd, path);
  recoverRegistrationArtifacts(cwd);
  return {
    readFile: (path) => new Uint8Array(readFileSync(resolve(path))),
    exists: (path) => existsSync(resolve(path)),
    mkdir: (path) => mkdirSync(resolve(path), { recursive: true }),
    write: (path, bytes) => writeFileSync(resolve(path), bytes),
    writeAtomic: (path, bytes) => {
      const temporary = `${resolve(path)}.tmp`;
      writeFileSync(temporary, bytes);
      renameSync(temporary, resolve(path));
    },
    replaceIfMatches: (path, stagedPath, expected) => {
      const lockPath = `${resolve(path)}.registration-lock`;
      const lockToken = acquireRegistrationLock(lockPath);
      let descriptor: number | undefined;
      try {
        descriptor = openSync(resolve(path), 'r+');
        const current = new Uint8Array(readFileSync(descriptor));
        if (
          sha256(current) !== expected.hash ||
          current.length !== expected.bytes.length ||
          current.some((byte, index) => byte !== expected.bytes[index])
        ) {
          throw new Error(
            `Registration root changed before replacement: ${path}`,
          );
        }
        const replacement = new Uint8Array(readFileSync(resolve(stagedPath)));
        const unchanged = readDescriptorSync(descriptor);
        if (
          sha256(unchanged) !== expected.hash ||
          unchanged.length !== expected.bytes.length ||
          unchanged.some((byte, index) => byte !== expected.bytes[index])
        ) {
          throw new Error(
            `Registration root changed before replacement: ${path}`,
          );
        }
        closeSync(descriptor);
        descriptor = undefined;
        renameSync(resolve(stagedPath), resolve(path));
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
        releaseRegistrationLock(lockPath, lockToken);
      }
      rmSync(resolve(stagedPath), { force: true });
    },
    replaceIfAbsent: (path, stagedPath) => {
      linkSync(resolve(stagedPath), resolve(path));
      rmSync(resolve(stagedPath), { force: true });
    },
    remove: (path) => rmSync(resolve(path), { force: true, recursive: true }),
    removeIfMatches: (path, expected) => {
      const current = new Uint8Array(readFileSync(resolve(path)));
      if (!sameBytes(current, expected))
        throw new Error(`File changed before conditional removal: ${path}`);
      rmSync(resolve(path), { force: true });
    },
    removeEmptyDir: (path) => rmdirSync(resolve(path)),
  };
}

interface RegistrationLockMetadata {
  pid: number;
  token: string;
}

function acquireRegistrationLock(lockPath: string): string {
  const token = `${process.pid}-${Date.now()}-${Math.random()}`;
  const ownerPath = `${lockPath}.${token}.owner`;
  writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, token }), 'utf8');

  try {
    try {
      linkSync(ownerPath, lockPath);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      const existing = readRegistrationLock(lockPath);
      if (existing && isProcessAlive(existing.pid)) {
        throw new Error(`Registration root is locked: ${lockPath}`);
      }
      if (!existing) {
        throw new Error(`Registration root lock is unreadable: ${lockPath}`);
      }
      const stalePath = `${lockPath}.${token}.stale`;
      try {
        renameSync(lockPath, stalePath);
        try {
          linkSync(ownerPath, lockPath);
        } catch (takeoverError) {
          if (isAlreadyExistsError(takeoverError)) {
            throw new Error(`Registration root is locked: ${lockPath}`);
          }
          throw takeoverError;
        }
      } finally {
        rmSync(stalePath, { force: true, recursive: true });
      }
    }
  } finally {
    rmSync(ownerPath, { force: true });
  }

  return token;
}

function releaseRegistrationLock(lockPath: string, token: string): void {
  const owner = readRegistrationLock(lockPath);
  if (owner?.token === token) {
    rmSync(lockPath, { force: true, recursive: true });
  }
}

function readRegistrationLock(
  lockPath: string,
): RegistrationLockMetadata | undefined {
  try {
    const content = readFileSync(lockPath, 'utf8');
    const metadata: unknown = JSON.parse(content);
    if (
      typeof metadata !== 'object' ||
      metadata === null ||
      typeof (metadata as RegistrationLockMetadata).pid !== 'number' ||
      typeof (metadata as RegistrationLockMetadata).token !== 'string'
    ) {
      return undefined;
    }
    return metadata as RegistrationLockMetadata;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function recoverRegistrationArtifacts(cwd: string): void {
  for (const root of [
    'src/app.module.ts',
    'src/config/database/data-source.ts',
  ]) {
    const target = joinPath(cwd, root);
    const parent = target.slice(0, target.lastIndexOf('/'));
    const name = target.slice(target.lastIndexOf('/') + 1);
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent)) {
      if (!entry.startsWith(`${name}.registration-`) || !entry.endsWith('.bak'))
        continue;
      const backup = joinPath(parent, entry);
      const token = entry.slice(`${name}.`.length, -'.bak'.length);
      const staged = `${target}.${token}.tmp`;
      const backupBytes = new Uint8Array(readFileSync(backup));
      const original =
        decodeRegistrationBackup(backupBytes, { sha256 }) ??
        decodeLegacyRegistrationBackup(backupBytes, root);
      if (!original) {
        rmSync(backup, { force: true });
        continue;
      }
      if (existsSync(target)) {
        const current = new Uint8Array(readFileSync(target));
        if (sameBytes(current, original)) {
          rmSync(backup, { force: true });
          if (existsSync(staged)) rmSync(staged, { force: true });
          continue;
        }
        if (existsSync(staged)) {
          const candidate = new Uint8Array(readFileSync(staged));
          if (sameBytes(current, candidate)) {
            rmSync(backup, { force: true });
            rmSync(staged, { force: true });
            continue;
          }
        }
      }
      const recovery = `${target}.${token}.recovery.tmp`;
      writeFileSync(recovery, original);
      renameSync(recovery, target);
      rmSync(backup, { force: true });
      if (existsSync(staged)) rmSync(staged, { force: true });
    }
  }
}

function decodeLegacyRegistrationBackup(
  bytes: Uint8Array,
  root: string,
): Uint8Array | undefined {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    parseSupportedRoot(root, text);
    return bytes;
  } catch {
    return undefined;
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

function readDescriptorSync(descriptor: number): Uint8Array {
  const size = fstatSync(descriptor).size;
  const bytes = Buffer.alloc(size);
  readSync(descriptor, bytes, 0, size, 0);
  return new Uint8Array(bytes);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function capitalize(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}

function renderTemplate(relativePath: string, name: NameModel): string {
  if (relativePath.endsWith('.module.ts')) return renderModuleTemplate(name);
  if (relativePath.endsWith('.controller.ts')) {
    return renderControllerTemplate(name);
  }
  if (relativePath.endsWith('.service.ts')) return renderServiceTemplate(name);
  if (relativePath.endsWith('.entity.ts')) {
    return renderEntityTemplate(name);
  }
  if (relativePath.includes('/dto/create-')) {
    return renderCreateDtoTemplate(name);
  }
  if (relativePath.includes('/dto/update-')) {
    return renderUpdateDtoTemplate(name);
  }
  if (relativePath.endsWith('.service.spec.ts')) {
    return renderServiceContractTest(name);
  }
  return '';
}

function renderServiceContractTest(name: NameModel): string {
  return `import 'reflect-metadata';
 import { BadRequestException, ValidationPipe } from '@nestjs/common';
 import { describe, expect, it } from 'bun:test';
 import { getMetadataStorage } from 'class-validator';
 import { getMetadataArgsStorage } from 'typeorm';
 import { BaseService } from '../../../src/common/services/base.service';
 import { Create${name.className}Dto } from '../../../src/modules/${name.moduleName}/dto/create-${name.moduleName}.dto';
 import { ${name.className}Controller } from '../../../src/modules/${name.moduleName}/${name.moduleName}.controller';
 import { ${name.entityName} } from '../../../src/modules/${name.moduleName}/${name.moduleName}.entity';
 import { ${name.className}Service } from '../../../src/modules/${name.moduleName}/${name.moduleName}.service';

describe('${name.moduleName} generated service contract', () => {
  it('extends the repository BaseService contract', () => {
    expect(${name.className}Service.prototype).toBeInstanceOf(BaseService);
  });

   it('exposes runtime validation and controller metadata', () => {
    expect(
      getMetadataStorage().getTargetValidationMetadatas(
        Create${name.className}Dto,
        '',
        false,
        false,
      ),
    ).toHaveLength(3);
    expect(Reflect.getMetadata('design:paramtypes', ${name.className}Controller)).toEqual([
      ${name.className}Service,
    ]);
     expect(Object.getPrototypeOf(${name.className}Controller.prototype)).toHaveProperty(
       'find',
     );
   });

   it('rejects invalid create DTO data through the CRUD validation pipe', async () => {
     const validationPipe = new ValidationPipe({
       whitelist: true,
       forbidNonWhitelisted: true,
       transform: true,
       expectedType: Create${name.className}Dto,
     });

     await expect(
       validationPipe.transform(
         { name: '' },
         { type: 'body', metatype: Object, data: '' },
       ),
     ).rejects.toBeInstanceOf(BadRequestException);
   });

   it('exposes explicit TypeORM table and column metadata', () => {
    const storage = getMetadataArgsStorage();
    expect(storage.tables.find(({ target }) => target === ${name.entityName})?.name).toBe(
      '${name.tableName}',
    );
    expect(
      storage.columns.filter(({ target }) => target === ${name.entityName}),
    ).toHaveLength(5);
  });
});
`;
}

function joinPath(...parts: string[]): string {
  return parts.join('/').replaceAll('\\', '/');
}

function parentPath(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const nodeFileSystem: FileSystem = {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  mkdtempSync: (prefix) =>
    mkdtempSync(prefix || `${tmpdir()}/module-generator-`),
  removeEmptyDir: (path) => rmdirSync(path),
};
import { renderControllerTemplate } from './templates/controller.template';
import { renderCreateDtoTemplate } from './templates/create-dto.template';
import { renderEntityTemplate } from './templates/entity.template';
import { renderModuleTemplate } from './templates/module.template';
import { renderServiceTemplate } from './templates/service.template';
import { renderUpdateDtoTemplate } from './templates/update-dto.template';
import { createHash } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  linkSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import {
  createRegistrationPlan,
  parseSupportedRoot,
  preflightRegistration,
  type RegistrationFileSystem,
} from './registration';
import { decodeRegistrationBackup, RegistrationPublisher } from './publisher';
