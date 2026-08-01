import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const sourceRoots = ['src', 'test', 'tools', 'packages'];
const sourceExtensions = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
]);
const focusedTestPattern =
  /(?:\b(?:describe|it|test|suite|specify)\.only\s*\(|\b(?:fit|fdescribe)\s*\()/;

export function findFocusedTests(root: string): string[] {
  const matches: string[] = [];
  for (const sourceRoot of sourceRoots) {
    const path = resolve(root, sourceRoot);
    if (existsSync(path)) scanDirectory(path, matches);
  }
  return matches;
}

function scanDirectory(directory: string, matches: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (
      entry.isDirectory() &&
      !['.build-types', 'dist', 'node_modules'].includes(entry.name)
    )
      scanDirectory(path, matches);
    else if (
      sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf('.'))) &&
      focusedTestPattern.test(readFileSync(path, 'utf8'))
    )
      matches.push(path);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  const focusedTests = findFocusedTests(process.cwd());
  if (focusedTests.length > 0) {
    console.error(
      `Focused tests are not allowed in CI:\n${focusedTests.join('\n')}`,
    );
    process.exit(1);
  }
}
