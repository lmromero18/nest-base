import {
  deriveNameModel,
  STANDARD_FILE_PATHS,
  type NameModel,
} from './generator';
import * as ts from 'typescript';
import { createHash } from 'node:crypto';

export interface RegistrationFileSystem {
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

export interface ParsedRoot {
  path: string;
  imports: readonly string[];
  importBindings: readonly {
    path: string;
    symbols: readonly string[];
    bindings: readonly { local: string; imported: string }[];
  }[];
  members: readonly string[];
  tokens: readonly TokenSpan[];
  eol: '\n' | '\r\n';
  bom: boolean;
  firstNonImportStart: number;
  targetArrayClose: number;
  arrayOpen: number;
}

export interface TokenSpan {
  kind: ts.SyntaxKind;
  start: number;
  end: number;
}

export class RegistrationDiagnosticError extends Error {
  constructor(
    readonly path: string,
    construct: string,
    detail: string,
  ) {
    super(`Registration refused for ${path} (${construct}): ${detail}`);
    this.name = 'RegistrationDiagnosticError';
  }
}

export interface RegistrationParser {
  parseRoot(path: string, text: string): ParsedRoot;
}

export type RegistrationEntryState =
  'missing' | 'exact' | 'duplicate' | 'mismatched';

export interface RegistrationRootTarget {
  path: string;
  importPath: string;
  symbol: string;
  memberCollection: 'imports' | 'entities';
}

export interface RegistrationImport {
  path: string;
  symbol: string;
  target: string;
}

export interface RegistrationPreview {
  path: string;
  action: 'create' | 'edit';
  symbol?: string;
  importPath?: string;
  memberCollection?: 'imports' | 'entities';
}

export interface RegistrationPlan {
  name: NameModel;
  moduleSymbol: string;
  entitySymbol: string;
  generatedDestinations: readonly string[];
  rootTargets: readonly RegistrationRootTarget[];
  imports: readonly RegistrationImport[];
  previews: readonly RegistrationPreview[];
}

export interface RegistrationSnapshot {
  generated: Array<{
    path: string;
    state: RegistrationEntryState;
  }>;
  roots: Array<{
    target: RegistrationRootTarget;
    importState: RegistrationEntryState;
    memberState: RegistrationEntryState;
  }>;
}

export type RegistrationState =
  | { status: 'ready' }
  | { status: 'already-registered' }
  | {
      status: 'collision';
      reason: 'duplicate' | 'partial' | 'mismatched';
    };

export interface RegistrationEditor {
  readonly plan: RegistrationPlan;
  classify(snapshot: RegistrationSnapshot): RegistrationState;
}

export function createRegistrationPlan(
  name: string | NameModel,
): RegistrationPlan {
  const model = typeof name === 'string' ? deriveNameModel(name) : name;
  const generatedDestinations = STANDARD_FILE_PATHS.map((path) =>
    path.replaceAll('<module>', model.moduleName),
  );
  const moduleSymbol = `${model.className}Module`;
  const entitySymbol = model.entityName;
  const rootTargets: readonly RegistrationRootTarget[] = [
    {
      path: 'src/app.module.ts',
      importPath: `./modules/${model.moduleName}/${model.moduleName}.module`,
      symbol: moduleSymbol,
      memberCollection: 'imports',
    },
    {
      path: 'src/config/database/data-source.ts',
      importPath: `../../modules/${model.moduleName}/${model.moduleName}.entity`,
      symbol: entitySymbol,
      memberCollection: 'entities',
    },
  ];
  const imports = [...rootTargets]
    .sort((left, right) =>
      `${left.importPath}\0${left.symbol}`.localeCompare(
        `${right.importPath}\0${right.symbol}`,
      ),
    )
    .map(({ importPath: path, symbol, ...target }) => ({
      path,
      symbol,
      target: target.path,
    }));

  return {
    name: model,
    moduleSymbol,
    entitySymbol,
    generatedDestinations,
    rootTargets,
    imports,
    previews: [
      ...generatedDestinations.map((path) => ({
        path,
        action: 'create' as const,
      })),
      ...rootTargets.map((target) => ({
        path: target.path,
        action: 'edit' as const,
        symbol: target.symbol,
        importPath: target.importPath,
        memberCollection: target.memberCollection,
      })),
    ],
  };
}

export function classifyRegistrationState(
  snapshot: RegistrationSnapshot,
): RegistrationState {
  if (
    snapshot.generated.length !== STANDARD_FILE_PATHS.length ||
    snapshot.roots.length !== 2 ||
    snapshot.roots.some(({ target }) => !target.path || !target.symbol)
  ) {
    throw new Error('Registration refused: empty or incomplete snapshot.');
  }
  const entries = [
    ...snapshot.generated.map(({ state }) => state),
    ...snapshot.roots.flatMap(({ importState, memberState }) => [
      importState,
      memberState,
    ]),
  ];
  if (entries.includes('duplicate')) {
    return { status: 'collision', reason: 'duplicate' };
  }
  if (entries.includes('mismatched')) {
    return { status: 'collision', reason: 'mismatched' };
  }
  if (entries.every((state) => state === 'missing')) {
    return { status: 'ready' };
  }
  if (entries.every((state) => state === 'exact')) {
    return { status: 'already-registered' };
  }
  return { status: 'collision', reason: 'partial' };
}

export function createRegistrationEditor(
  plan: RegistrationPlan,
): RegistrationEditor {
  return { plan, classify: classifyRegistrationState };
}

export function parseSupportedRoot(path: string, text: string): ParsedRoot {
  const hasCrLf = /\r\n/.test(text);
  if (hasCrLf && text.replaceAll('\r\n', '').includes('\n')) {
    throw new RegistrationDiagnosticError(
      path,
      'line endings',
      'mixed LF and CRLF endings are unsupported',
    );
  }
  const eol: '\n' | '\r\n' = hasCrLf ? '\r\n' : '\n';
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostics = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.Latest },
    reportDiagnostics: true,
  }).diagnostics;
  if (
    diagnostics?.some(
      ({ category }) => category === ts.DiagnosticCategory.Error,
    )
  ) {
    throw new RegistrationDiagnosticError(
      path,
      'syntax',
      'malformed TypeScript',
    );
  }

  const tokens: TokenSpan[] = [];
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    text,
  );
  let kind: ts.SyntaxKind;
  while ((kind = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
    tokens.push({
      kind,
      start: scanner.getTokenPos(),
      end: scanner.getTextPos(),
    });
  }
  const imports = source.statements.filter(ts.isImportDeclaration);
  for (const statement of source.statements) {
    if (
      ts.isImportEqualsDeclaration(statement) ||
      (ts.isImportDeclaration(statement) &&
        !ts.isStringLiteral(statement.moduleSpecifier))
    ) {
      fail(path, 'imports', 'only static string module imports are supported');
    }
    if (ts.isImportDeclaration(statement) && isTypeOnlyImport(statement)) {
      fail(
        path,
        'imports',
        'type-only imports cannot be used for runtime registration',
      );
    }
  }
  if (
    source.statements.some((statement) =>
      ts.isImportEqualsDeclaration(statement),
    )
  ) {
    fail(path, 'imports', 'import equals syntax is unsupported');
  }
  if (containsDynamicImportCall(source)) {
    fail(path, 'imports', 'dynamic imports are unsupported');
  }
  const importPaths = imports.map(
    (statement) => (statement.moduleSpecifier as ts.StringLiteral).text,
  );
  const importBindings = imports.map((statement) => ({
    path: (statement.moduleSpecifier as ts.StringLiteral).text,
    symbols: collectImportSymbols(statement),
    bindings: collectImportBindings(statement),
  }));
  if (new Set(importPaths).size !== importPaths.length) {
    fail(
      path,
      'imports',
      'duplicate module import declarations are unsupported',
    );
  }

  const isApp = path.endsWith('app.module.ts');
  const array = isApp
    ? findAppImports(source, path)
    : findDataSourceEntities(source, path);
  const members = array.elements.map((element) => {
    if (
      element.kind === ts.SyntaxKind.OmittedExpression ||
      ts.isSpreadElement(element)
    ) {
      fail(
        path,
        isApp ? '@Module imports' : 'DataSource entities',
        'holes and spreads are unsupported',
      );
    }
    if (!isSupportedArrayElement(element)) {
      fail(
        path,
        isApp ? '@Module imports' : 'DataSource entities',
        'only identifiers and call/property-access expressions are supported',
      );
    }
    return element.getText(source);
  });
  if (new Set(members).size !== members.length) {
    fail(
      path,
      isApp ? '@Module imports' : 'DataSource entities',
      'duplicate members are unsupported',
    );
  }
  const close = array.getEnd() - 1;
  const firstNonImport = source.statements.find(
    (statement) => !ts.isImportDeclaration(statement),
  );
  const parsed: ParsedRoot = {
    path,
    imports: importPaths,
    importBindings,
    members,
    tokens,
    eol,
    bom: text.startsWith('\ufeff'),
    firstNonImportStart: firstNonImport?.getStart(source) ?? text.length,
    targetArrayClose: close,
    arrayOpen: array.getStart(source) + 1,
  };
  parsedTexts.set(parsed, text);
  return parsed;
}

function containsDynamicImportCall(source: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      found = true;
      return;
    }
    if (ts.isImportTypeNode(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return found;
}

export interface RegistrationPreflight {
  roots: readonly ParsedRoot[];
  rootSnapshots: readonly RegistrationRootSnapshot[];
  candidates: readonly string[];
  existingGenerated: readonly string[];
  status: 'ready' | 'already-registered';
}

export interface RegistrationRootSnapshot {
  root: ParsedRoot;
  bytes: Uint8Array;
  hash: string;
}

export interface ExpectedGeneratedFile {
  path: string;
  bytes: Uint8Array;
}

export function createRootCandidate(
  root: ParsedRoot,
  target: RegistrationRootTarget,
): string {
  const source = rootText(root);
  const importText = `import { ${target.symbol} } from '${target.importPath}';${root.eol}`;
  const withImport =
    source.slice(0, root.firstNonImportStart) +
    importText +
    source.slice(root.firstNonImportStart);
  const shift =
    root.firstNonImportStart < root.targetArrayClose ? importText.length : 0;
  const close = root.targetArrayClose + shift;
  const open =
    root.arrayOpen +
    (root.firstNonImportStart < root.arrayOpen ? importText.length : 0);
  const inside = withImport.slice(open, close);
  const closeLineStart =
    withImport.lastIndexOf(root.eol, close - 1) + root.eol.length;
  const closeIndent =
    withImport.slice(closeLineStart, close).match(/^\s*/)?.[0] ?? '';
  const multiline = inside.includes(root.eol);
  const insertion =
    inside.trim().length === 0
      ? multiline
        ? `${target.symbol},${root.eol}${closeIndent}`
        : target.symbol
      : multiline
        ? `${target.symbol},${root.eol}${closeIndent}`
        : `, ${target.symbol}`;
  return withImport.slice(0, close) + insertion + withImport.slice(close);
}

export function preflightRegistration(
  plan: RegistrationPlan,
  fileSystem: Pick<
    RegistrationFileSystem,
    'exists' | 'readFile' | 'mkdir' | 'write'
  > &
    Partial<Pick<RegistrationFileSystem, 'exists'>>,
  expectedGenerated: readonly ExpectedGeneratedFile[] = [],
): RegistrationPreflight {
  const roots: ParsedRoot[] = [];
  const rootSnapshots: RegistrationRootSnapshot[] = [];
  const candidates: string[] = [];
  const existingGenerated: string[] = [];
  let already = true;
  let exactRoots = 0;
  let missingRoots = 0;
  for (const target of plan.rootTargets) {
    if (!fileSystem.exists(target.path)) {
      fail(
        target.path,
        'root',
        'file is missing; restore the canonical project root before registration',
      );
    }
    const bytes = fileSystem.readFile(target.path);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    const root = parseSupportedRoot(target.path, text);
    const binding = root.importBindings.find(
      ({ path }) => path === target.importPath,
    );
    const exactImport = root.imports.filter(
      (path) => path === target.importPath,
    ).length;
    const exactMember = root.members.filter(
      (member) => member === target.symbol,
    ).length;
    if (exactImport > 1 || exactMember > 1)
      fail(target.path, 'identity', 'duplicate target import or member');
    if (
      root.imports.includes(target.importPath) !==
      root.members.includes(target.symbol)
    ) {
      fail(
        target.path,
        'identity',
        'import and member registration is partial',
      );
    }
    const exactBinding = binding?.bindings.some(
      ({ local, imported }) =>
        local === target.symbol && imported === target.symbol,
    );
    if (
      root.imports.includes(target.importPath) &&
      root.members.includes(target.symbol) &&
      exactBinding
    ) {
      exactRoots += 1;
      continue;
    }
    missingRoots += 1;
    if (binding && !binding.symbols.includes(target.symbol)) {
      fail(
        target.path,
        'identity',
        'existing import path has a different symbol',
      );
    }
    if (
      root.imports.some((path) => path === target.importPath) ||
      root.members.some((member) => member === target.symbol)
    ) {
      fail(
        target.path,
        'identity',
        'existing registration does not match the requested identity',
      );
    }
    already = false;
    const candidate = createRootCandidate(root, target);
    parseSupportedRoot(target.path, candidate);
    roots.push(root);
    rootSnapshots.push({ root, bytes: bytes.slice(), hash: hashBytes(bytes) });
    candidates.push(candidate);
  }
  let existingGeneratedCount = 0;
  for (const path of plan.generatedDestinations) {
    if (fileSystem.exists(path)) {
      existingGenerated.push(path);
      existingGeneratedCount += 1;
      const expected = expectedGenerated.find((file) => file.path === path);
      if (!expected)
        fail(path, 'destination', 'generated destination already exists');
      const actual = fileSystem.readFile(path);
      if (!sameBytes(actual, expected.bytes)) {
        fail(
          path,
          'destination',
          'generated destination differs from the requested output',
        );
      }
    }
  }
  if (
    exactRoots > 0 &&
    (missingRoots > 0 ||
      existingGeneratedCount < plan.generatedDestinations.length)
  ) {
    fail(
      plan.rootTargets[0].path,
      'identity',
      'partial registration is unsupported; roots and generated destinations must be complete',
    );
  }
  return {
    roots,
    rootSnapshots,
    candidates,
    existingGenerated,
    status: already ? 'already-registered' : 'ready',
  };
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

function findAppImports(
  source: ts.SourceFile,
  path: string,
): ts.ArrayLiteralExpression {
  const classes = source.statements.filter(
    (statement) =>
      ts.isClassDeclaration(statement) && statement.name?.text === 'AppModule',
  );
  if (classes.length !== 1)
    fail(path, 'AppModule', 'exactly one AppModule class is required');
  const decorators = getDecorators(classes[0]);
  const moduleDecorators = decorators.filter(
    (decorator) =>
      ts.isCallExpression(decorator.expression) &&
      ts.isIdentifier(decorator.expression.expression) &&
      decorator.expression.expression.text === 'Module',
  );
  if (moduleDecorators.length !== 1)
    fail(path, '@Module', 'exactly one @Module decorator is required');
  const moduleDecorator = moduleDecorators[0];
  if (
    !moduleDecorator ||
    !ts.isCallExpression(moduleDecorator.expression) ||
    !ts.isObjectLiteralExpression(moduleDecorator.expression.arguments[0])
  )
    fail(path, '@Module', 'canonical @Module({ imports: [...] }) is required');
  const property = moduleDecorator.expression.arguments[0].properties.find(
    (item) =>
      ts.isPropertyAssignment(item) &&
      ts.isIdentifier(item.name) &&
      item.name.text === 'imports',
  ) as ts.PropertyAssignment | undefined;
  if (!property || !ts.isArrayLiteralExpression(property.initializer))
    fail(path, '@Module imports', 'imports must be an array literal');
  validateObject(moduleDecorator.expression.arguments[0], path, '@Module');
  return property.initializer;
}

function findDataSourceEntities(
  source: ts.SourceFile,
  path: string,
): ts.ArrayLiteralExpression {
  const declarations = source.statements.filter(
    (statement) =>
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      ts.isNewExpression(statement.expression) &&
      ts.isIdentifier(statement.expression.expression) &&
      statement.expression.expression.text === 'DataSource',
  );
  if (declarations.length !== 1)
    fail(
      path,
      'DataSource',
      'exactly one default new DataSource({ ... }) is required',
    );
  const expression = (declarations[0] as ts.ExportAssignment)
    .expression as ts.NewExpression;
  const options = expression.arguments?.[0];
  if (!options || !ts.isObjectLiteralExpression(options))
    fail(path, 'DataSource', 'DataSource options must be an object literal');
  const property = options.properties.find(
    (item) =>
      ts.isPropertyAssignment(item) &&
      ts.isIdentifier(item.name) &&
      item.name.text === 'entities',
  ) as ts.PropertyAssignment | undefined;
  if (!property || !ts.isArrayLiteralExpression(property.initializer))
    fail(path, 'entities', 'entities must be an array literal');
  validateObject(options, path, 'DataSource options');
  return property.initializer;
}

function validateObject(
  object: ts.ObjectLiteralExpression,
  path: string,
  construct: string,
): void {
  const names = object.properties.map((property) =>
    ts.isSpreadAssignment(property) && construct === 'DataSource options'
      ? `spread:${property.getStart()}`
      : ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)
        ? property.name.text
        : undefined,
  );
  if (
    names.some((name) => name === undefined) ||
    new Set(names).size !== names.length
  )
    fail(
      path,
      construct,
      'computed properties, methods, and duplicate keys are unsupported',
    );
}

function isSupportedArrayElement(element: ts.Expression): boolean {
  return (
    ts.isIdentifier(element) ||
    ts.isCallExpression(element) ||
    ts.isPropertyAccessExpression(element)
  );
}

function collectImportSymbols(
  statement: ts.ImportDeclaration,
): readonly string[] {
  const clause = statement.importClause;
  if (!clause) return [];
  return [
    ...(clause.name ? [clause.name.text] : []),
    ...(clause.namedBindings
      ? ts.isNamespaceImport(clause.namedBindings)
        ? [clause.namedBindings.name.text]
        : clause.namedBindings.elements.map(({ name }) => name.text)
      : []),
  ];
}

function collectImportBindings(
  statement: ts.ImportDeclaration,
): readonly { local: string; imported: string }[] {
  const clause = statement.importClause;
  if (!clause) return [];
  const bindings: Array<{ local: string; imported: string }> = [];
  if (clause.name)
    bindings.push({ local: clause.name.text, imported: 'default' });
  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) {
      bindings.push({ local: clause.namedBindings.name.text, imported: '*' });
    } else {
      for (const element of clause.namedBindings.elements) {
        bindings.push({
          local: element.name.text,
          imported: element.propertyName?.text ?? element.name.text,
        });
      }
    }
  }
  return bindings;
}

function isTypeOnlyImport(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  return Boolean(
    clause?.isTypeOnly ||
    (clause?.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.some((element) => element.isTypeOnly)),
  );
}

function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function fail(path: string, construct: string, detail: string): never {
  throw new RegistrationDiagnosticError(path, construct, detail);
}

const parsedTexts = new WeakMap<ParsedRoot, string>();
function rootText(root: ParsedRoot): string {
  const text = parsedTexts.get(root);
  if (!text) throw new Error('Parsed root text is unavailable.');
  return text;
}
