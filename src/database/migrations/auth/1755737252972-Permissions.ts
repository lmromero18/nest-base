import { MigrationInterface, QueryRunner } from "typeorm";

export class Permissions1755737252972 implements MigrationInterface {
    name = 'Permissions1755737252972'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_permiso" DROP COLUMN "ts_eliminacion"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_permiso" ADD "ts_eliminacion" TIMESTAMP`);
    }

}
