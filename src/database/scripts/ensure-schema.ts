import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  const ds = process.env.DATASOURCE_NAME === 'auth' ? 'AUTH_DB_' : 'DB_';
  const schema = process.env[`${ds}SCHEMA`];
  if (!schema) {
    console.log('No schema configured; skipping.');
    return;
  }
  const pool = new Pool({
    host: process.env[`${ds}HOST`],
    port: Number(process.env[`${ds}PORT`] || 5432),
    user: process.env[`${ds}USERNAME`],
    password: process.env[`${ds}PASSWORD`],
    database: process.env[`${ds}DATABASE`],
  });
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    console.log(`Schema ensured: ${schema}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
