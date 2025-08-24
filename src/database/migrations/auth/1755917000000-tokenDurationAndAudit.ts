import { MigrationInterface, QueryRunner } from 'typeorm';

export class TokenDurationAndAudit1755917000000 implements MigrationInterface {
  name = 'TokenDurationAndAudit1755917000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tb_cliente" ADD "nu_tiempo_token_min" integer NOT NULL DEFAULT 30`,
    );
    await queryRunner.query(
      `ALTER TABLE "tb_token_acceso" ADD "nu_duracion_min" integer NOT NULL DEFAULT 30`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tb_token_acceso" DROP COLUMN "nu_duracion_min"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tb_cliente" DROP COLUMN "nu_tiempo_token_min"`,
    );
  }
}
