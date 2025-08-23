import { MigrationInterface, QueryRunner } from "typeorm";

export class TbTokenAcceso1755916159993 implements MigrationInterface {
    name = 'TbTokenAcceso1755916159993'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" DROP CONSTRAINT "PK_0ef175933101ac049e2313a5545"`);
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" DROP COLUMN "id_token_acceso"`);
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" DROP CONSTRAINT "UQ_2ebd6e69c804bc181e9bfaca56d"`);
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" DROP COLUMN "tx_jid"`);
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" ADD "id_jid" uuid NOT NULL DEFAULT uuid_generate_v4()`);
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" ADD CONSTRAINT "PK_6ead48065f9e8847e84c66049bf" PRIMARY KEY ("id_jid")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" DROP CONSTRAINT "PK_6ead48065f9e8847e84c66049bf"`);
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" DROP COLUMN "id_jid"`);
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" ADD "tx_jid" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" ADD CONSTRAINT "UQ_2ebd6e69c804bc181e9bfaca56d" UNIQUE ("tx_jid")`);
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" ADD "id_token_acceso" SERIAL NOT NULL`);
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" ADD CONSTRAINT "PK_0ef175933101ac049e2313a5545" PRIMARY KEY ("id_token_acceso")`);
    }

}
