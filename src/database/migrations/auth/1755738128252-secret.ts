import { MigrationInterface, QueryRunner } from "typeorm";

export class Secret1755738128252 implements MigrationInterface {
    name = 'Secret1755738128252'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_cliente" ADD "tx_secreto" character varying(128) NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_cliente" DROP COLUMN "tx_secreto"`);
    }

}
