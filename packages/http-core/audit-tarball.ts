import { resolve } from 'node:path';

const root = resolve(import.meta.dir);
const result = Bun.spawnSync(
  ['npm', 'pack', '--dry-run', '--json', '--ignore-scripts'],
  { cwd: root, stdout: 'pipe', stderr: 'pipe' },
);
if (result.exitCode !== 0)
  throw new Error(new TextDecoder().decode(result.stderr));
const report = JSON.parse(new TextDecoder().decode(result.stdout)) as Array<{
  files?: Array<{ path: string }>;
}>;
const entries = (report[0]?.files ?? []).map(({ path }) => path).sort();
const allowed =
  /^(README\.md|LICENSE|package\.json|dist\/(cjs\/package\.json|(esm|cjs)\/.*\.js(?:\.map)?|types\/.*\.d\.ts))$/;
const violations = entries.filter((entry) => !allowed.test(entry));
for (const required of [
  'README.md',
  'LICENSE',
  'package.json',
  'dist/cjs/package.json',
])
  if (!entries.includes(required)) violations.push(`missing ${required}`);
if (violations.length)
  throw new Error(`Tarball audit failed:\n${violations.join('\n')}`);
console.log(`audit:http-core:tarball passed (${entries.length} entries)`);
