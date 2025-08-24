import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnsureSchema1755000000000 implements MigrationInterface {
  name = 'EnsureSchema1755000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Read the current search_path; first entry is the target default schema
    const result: any = await queryRunner.query(`SHOW search_path`);
    const val = Array.isArray(result) ? result[0]?.search_path ?? '' : result;
    const firstPath = String(val).split(',')[0]?.trim()?.replace(/^"|"$/g, '') ?? '';

    if (firstPath && firstPath !== 'public') {
      await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "${firstPath}"`);
      // Ensure the session uses it for the rest of the run
      await queryRunner.query(`SET search_path TO "${firstPath}", public`);
    }
  }

  public async down(): Promise<void> {
    // no-op: we don't drop schemas automatically
  }
}
