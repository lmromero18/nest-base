import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { Client } from 'pg';

const root = resolve(__dirname, '..');
const envPath = resolve(root, '.env.test');
const compose = [
  'compose',
  '--env-file',
  envPath,
  '-f',
  resolve(root, 'compose.postgres-test.yml'),
];
function docker(args: string[]) {
  execFileSync('docker', [...compose, ...args], {
    cwd: root,
    stdio: 'inherit',
  });
}
async function assertFreePort(port: number) {
  const server = createServer();
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      server.close((error) => (error ? reject(error) : accept())),
    );
  });
}
export function testDatabaseUrl(): string {
  const value =
    process.env.NEST_BASE_TEST_DATABASE_URL ??
    (existsSync(envPath)
      ? parse(readFileSync(envPath)).NEST_BASE_TEST_DATABASE_URL
      : undefined);
  if (!value)
    throw new Error('Configure .env.test using bun run test:postgres:setup');
  const url = new URL(value);
  if (
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.pathname !== '/nest_base_test' ||
    url.username !== 'nest_base_test'
  )
    throw new Error(
      'Integration requires the dedicated local nest_base_test database and user',
    );
  return value;
}
async function verify() {
  const client = new Client({
    connectionString: testDatabaseUrl(),
    connectionTimeoutMillis: 5000,
  });
  const schema = 'nest_base_probe_' + randomUUID().replaceAll('-', '');
  let created = false;
  try {
    await client.connect();
    const result = await client.query<{
      database: string;
      username: string;
      version: string;
    }>(
      'SELECT current_database() AS database, current_user AS username, version() AS version',
    );
    if (
      result.rows[0].database !== 'nest_base_test' ||
      result.rows[0].username !== 'nest_base_test'
    )
      throw new Error('Wrong test database');
    await client.query('CREATE SCHEMA "' + schema + '"');
    created = true;
    await client.query('DROP SCHEMA "' + schema + '"');
    created = false;
    console.log('PostgreSQL dedicated connection + CREATE/DROP SCHEMA PASS');
  } finally {
    try {
      if (created) await client.query('DROP SCHEMA "' + schema + '" CASCADE');
    } finally {
      await client.end();
    }
  }
}
async function main() {
  const action = process.argv[2] ?? 'verify';
  if (action === 'setup') {
    execFileSync('git', ['check-ignore', '--quiet', '.env.test'], {
      cwd: root,
    });
    if (!existsSync(envPath)) {
      const port = 5434;
      await assertFreePort(port);
      const password = randomBytes(32).toString('hex');
      writeFileSync(
        envPath,
        'NEST_BASE_TEST_PORT=' +
          port +
          '\nNEST_BASE_TEST_PASSWORD=' +
          password +
          '\nNEST_BASE_TEST_DATABASE_URL=postgresql://nest_base_test:' +
          password +
          '@127.0.0.1:' +
          port +
          '/nest_base_test\n',
        { mode: 0o600, flag: 'wx' },
      );
    }
    docker(['up', '-d', '--wait', '--wait-timeout', '90']);
    await verify();
  } else if (action === 'stop') docker(['stop']);
  else if (action === 'verify') await verify();
  else throw new Error('Unknown postgres test command');
}
if (resolve(process.argv[1] ?? '') === resolve(__dirname, 'postgres-test.ts')) {
  main().catch((error: unknown) => {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'FAILED';
    console.error(
      'PostgreSQL test infrastructure failed (' +
        code +
        '); inspect Docker availability and local configuration. Credentials omitted.',
    );
    process.exitCode = 1;
  });
}
