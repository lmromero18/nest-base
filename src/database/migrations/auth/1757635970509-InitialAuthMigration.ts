import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialAuthMigration1757635970509 implements MigrationInterface {
    name = 'InitialAuthMigration1757635970509'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_rol" ADD "is_super_usuario" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_rol" DROP COLUMN "is_super_usuario"`);
    }

}
