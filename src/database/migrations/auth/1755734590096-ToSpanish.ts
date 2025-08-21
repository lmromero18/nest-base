import { MigrationInterface, QueryRunner } from "typeorm";

export class ToSpanish1755734590096 implements MigrationInterface {
    name = 'ToSpanish1755734590096'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_cliente" ADD "ts_creacion" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "tb_cliente" ADD "ts_actualizacion" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "tb_usuario" ADD "ts_creacion" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "tb_usuario" ADD "ts_actualizacion" TIMESTAMP NOT NULL DEFAULT now()`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_usuario" DROP COLUMN "ts_actualizacion"`);
        await queryRunner.query(`ALTER TABLE "tb_usuario" DROP COLUMN "ts_creacion"`);
        await queryRunner.query(`ALTER TABLE "tb_cliente" DROP COLUMN "ts_actualizacion"`);
        await queryRunner.query(`ALTER TABLE "tb_cliente" DROP COLUMN "ts_creacion"`);
    }

}
