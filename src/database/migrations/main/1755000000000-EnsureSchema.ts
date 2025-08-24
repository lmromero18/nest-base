import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnsureSchemaMain1755000000000 implements MigrationInterface {
  name = 'EnsureSchemaMain1755000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const result: any = await queryRunner.query(`SHOW search_path`);
    const val = Array.isArray(result) ? result[0]?.search_path ?? '' : result;
    const firstPath = String(val).split(',')[0]?.trim()?.replace(/^"|"$/g, '') ?? '';
    if (firstPath && firstPath !== 'public') {
      await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "${firstPath}"`);
      await queryRunner.query(`SET search_path TO "${firstPath}", public`);
    }
  }

  public async down(): Promise<void> {
    // no-op
  }
}
