import { ESLint } from 'eslint';
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const eslint = new ESLint({
  overrideConfigFile: 'eslint.config.mjs',
});

async function lintImport(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(
    (message) => message.ruleId === 'no-restricted-imports',
  );
}

describe('framework boundary import rules', () => {
  it('rejects core imports from application and infrastructure concerns', async () => {
    const messages = await lintImport(
      [
        "import { ConfigService } from '@nestjs/config';",
        "import { NotificationModule } from '../../modules/notification/notification.module';",
        "import Fastify from 'fastify';",
      ].join('\n'),
      'src/common/services/base.service.ts',
    );

    expect(messages).toHaveLength(3);
    expect(messages[0]?.message).toContain(
      'Core code must not depend on transport, authentication, Swagger, or outbound integration packages.',
    );
    expect(messages[1]?.message).toContain(
      'Core code must not depend on application modules, policy, or transport/infrastructure adapters.',
    );
    expect(messages[2]?.message).toContain(
      'Core code must not depend on transport, authentication, Swagger, or outbound integration packages.',
    );
  });

  it('allows core dependencies and application-to-core usage', async () => {
    const coreMessages = await lintImport(
      "import { Repository } from 'typeorm';",
      'src/common/services/base.service.ts',
    );
    const applicationMessages = await lintImport(
      "import { BaseService } from '../../common/services/base.service';",
      'src/modules/example/example.service.ts',
    );

    expect(coreMessages).toEqual([]);
    expect(applicationMessages).toEqual([]);
  });

  it('keeps reusable application contracts free of transport imports', () => {
    const contractFiles = [
      'src/common/application/principal.ts',
      'src/common/application/application-error.ts',
      'src/common/application/crud.contracts.ts',
    ];
    const forbiddenImports = [
      '@nestjs/',
      'fastify',
      '@nestjs/jwt',
      'rxjs',
      'typeorm',
      '/context/',
      '/interfaces/jwt-payload',
    ];

    for (const file of contractFiles) {
      const source = readFileSync(resolve(file), 'utf8');
      for (const forbidden of forbiddenImports) {
        expect(source).not.toContain(`from '${forbidden}`);
        expect(source).not.toContain(`from "${forbidden}`);
      }
    }
  });
});
