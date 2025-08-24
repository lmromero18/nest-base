import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveLegacyUserTable1756000002000 implements MigrationInterface {
  name = 'RemoveLegacyUserTable1756000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop legacy tb_user if it exists
    await queryRunner.query('DROP TABLE IF EXISTS "tb_user" CASCADE');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate a minimal legacy tb_user (no FKs) to allow revert
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS "tb_user" ("id_user" SERIAL NOT NULL, "tx_username" character varying NOT NULL, "tx_password" character varying NOT NULL, CONSTRAINT "UQ_dcc1d6e2ead0f82098820328875" UNIQUE ("tx_username"), CONSTRAINT "PK_5c3a6c23c570ba478c95002cdc7" PRIMARY KEY ("id_user"))',
    );
  }
}
