import { describe, expect, it } from 'bun:test';
import {
  inspectPackList,
  type PackedEntry,
} from '../../../packages/core/tarball';

describe('@nest-base/core tarball contract', () => {
  it('accepts the deterministic runtime, declaration, and documentation allowlist', () => {
    const entries = validEntries();

    expect(inspectPackList(entries)).toEqual({
      entries: entries.map(({ path }) => path).sort(),
      violations: [],
    });
  });

  it('rejects source, tests, secrets, forbidden paths, and forbidden bundled text', () => {
    const violations = inspectPackList([
      ...validEntries(),
      { path: 'package/src/index.ts', content: 'export {}' },
      { path: 'package/test/leak.spec.ts', content: 'test' },
      { path: 'package/.env', content: 'SECRET=value' },
      { path: 'package/dist/esm/leak.js', content: "import 'fastify';" },
      { path: 'package/dist/esm/secret.js', content: 'JWT_SECRET' },
      { path: 'package/dist/readme.txt', content: 'not a runtime artifact' },
    ]).violations;

    expect(violations).toEqual([
      'forbidden bundled text "JWT_SECRET" in package/dist/esm/secret.js',
      'forbidden bundled text "fastify" in package/dist/esm/leak.js',
      'forbidden entry package/.env',
      'forbidden entry package/dist/readme.txt',
      'forbidden entry package/src/index.ts',
      'forbidden entry package/test/leak.spec.ts',
    ]);
  });

  it('rejects an ESM-only tarball and a CJS-only tarball independently', () => {
    const esmOnly = validEntries().filter(
      ({ path }) =>
        !path.includes('/dist/cjs/') || path.endsWith('/package.json'),
    );
    const cjsOnly = validEntries().filter(
      ({ path }) => !path.includes('/dist/esm/'),
    );

    expect(inspectPackList(esmOnly).violations).toContain(
      'missing CJS JavaScript output index',
    );
    expect(inspectPackList(cjsOnly).violations).toContain(
      'missing ESM JavaScript output index',
    );
  });
});

function validEntries(): PackedEntry[] {
  return [
    { path: 'package/LICENSE', content: 'MIT' },
    { path: 'package/README.md', content: '# core' },
    { path: 'package/package.json', content: '{}' },
    { path: 'package/dist/cjs/package.json', content: '{"type":"commonjs"}' },
    ...[
      'index',
      'services/index',
      'query/index',
      'application/index',
      'context/index',
    ].flatMap((subpath) => [
      {
        path: `package/dist/cjs/${subpath}.js`,
        content: 'module.exports = {};',
      },
      { path: `package/dist/cjs/${subpath}.js.map`, content: '{}' },
      { path: `package/dist/esm/${subpath}.js`, content: 'export {};' },
      { path: `package/dist/esm/${subpath}.js.map`, content: '{}' },
      {
        path: `package/dist/types/${subpath}.d.ts`,
        content: 'export type Core = {};\n',
      },
    ]),
  ];
}
