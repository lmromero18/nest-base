import { MigrationInterface, QueryRunner } from "typeorm";

export class Permissions1756249836139 implements MigrationInterface {
    name = 'Permissions1756249836139'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_permiso" ADD "nb_permiso" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "tb_permiso" ADD "tx_descripcion" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_permiso" DROP COLUMN "tx_descripcion"`);
        await queryRunner.query(`ALTER TABLE "tb_permiso" DROP COLUMN "nb_permiso"`);
    }

}
