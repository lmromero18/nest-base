const forbiddenEntryPatterns = [
  /(^|\/)(src|test|tests|fixtures|app|config|migrations?)(\/|$)/i,
  /(^|\/)(\.env|.*\.pem|.*\.key|.*\.secret)(\/|$)/i,
  /\.ts$/i,
  /(^|\/)(bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock)$/i,
];

const forbiddenText = [
  'fastify',
  '@nestjs/',
  'class-validator',
  'winston',
  'jsonwebtoken',
  'nest-winston',
  'nodemailer',
  'JWT_SECRET',
  'node_modules/',
];

const allowedEntryPatterns = [
  /^package\/(README\.md|LICENSE|package\.json)$/,
  /^package\/dist\/cjs\/package\.json$/,
  /^package\/dist\/(esm|cjs)\/.*\.js(?:\.map)?$/,
  /^package\/dist\/types\/.*\.d\.ts$/,
];

const requiredRuntimeSubpaths = [
  'index',
  'services/index',
  'query/index',
  'application/index',
  'context/index',
];

export interface PackedEntry {
  path: string;
  content?: string;
}

export interface PackInspection {
  entries: string[];
  violations: string[];
}

export function inspectPackList(input: PackedEntry[]): PackInspection {
  const entries = [...new Set(input.map(({ path }) => path))].sort();
  const violations = new Set<string>();

  for (const entry of entries) {
    if (
      forbiddenEntryPatterns.some((pattern) =>
        pattern.source === '\\.ts$'
          ? /\.ts$/i.test(entry) && !/\.d\.ts$/i.test(entry)
          : pattern.test(entry),
      )
    )
      violations.add(`forbidden entry ${entry}`);
    if (!allowedEntryPatterns.some((pattern) => pattern.test(entry)))
      violations.add(`forbidden entry ${entry}`);
  }

  for (const entry of input) {
    if (!entry.content) continue;
    for (const token of forbiddenText) {
      if (entry.content.includes(token))
        violations.add(`forbidden bundled text "${token}" in ${entry.path}`);
    }
  }

  const required = [
    'package/LICENSE',
    'package/README.md',
    'package/package.json',
    'package/dist/cjs/package.json',
  ];
  for (const path of required) {
    if (!entries.includes(path))
      violations.add(`missing required entry ${path}`);
  }

  for (const subpath of requiredRuntimeSubpaths) {
    for (const format of ['esm', 'cjs'] as const) {
      if (!entries.includes(`package/dist/${format}/${subpath}.js`))
        violations.add(
          `missing ${format.toUpperCase()} JavaScript output ${subpath}`,
        );
      if (!entries.includes(`package/dist/${format}/${subpath}.js.map`))
        violations.add(`missing ${format.toUpperCase()} source map ${subpath}`);
    }
    if (!entries.includes(`package/dist/types/${subpath}.d.ts`))
      violations.add(`missing declaration output ${subpath}`);
  }

  return { entries, violations: [...violations].sort() };
}
