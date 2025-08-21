import { MigrationInterface, QueryRunner } from "typeorm";

export class Enhance1755735348083 implements MigrationInterface {
    name = 'Enhance1755735348083'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_usuario" ADD "st_usuario" character varying NOT NULL DEFAULT 'ACTIVO'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_usuario" DROP COLUMN "st_usuario"`);
    }

}
