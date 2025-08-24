import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveLegacyClientTable1756000001000 implements MigrationInterface {
  name = 'RemoveLegacyClientTable1756000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop FK from legacy tb_user to legacy tb_client if they exist
    await queryRunner.query(
      'ALTER TABLE IF EXISTS "tb_user" DROP CONSTRAINT IF EXISTS "FK_3fd6032fb79301a2824a8cb3c03"',
    );
    // Drop legacy tb_client if exists
    await queryRunner.query('DROP TABLE IF EXISTS "tb_client" CASCADE');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate minimal legacy table (no FKs) in case of revert
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS "tb_client" ("id_client" uuid NOT NULL DEFAULT uuid_generate_v4(), "nb_client" character varying NOT NULL, CONSTRAINT "UQ_93dab32b4a30e8d6161ef791fac" UNIQUE ("nb_client"), CONSTRAINT "PK_a08b0cee357d346fd6086cbd6ef" PRIMARY KEY ("id_client"))',
    );
  }
}
