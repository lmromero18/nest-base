import { MigrationInterface, QueryRunner } from "typeorm";

export class Permissions1755829890178 implements MigrationInterface {
    name = 'Permissions1755829890178'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "tb_usuario_rol" ("id_usuario" integer NOT NULL, "id_rol" integer NOT NULL, CONSTRAINT "PK_a4bdbf167f98987404b0a2b683c" PRIMARY KEY ("id_usuario", "id_rol"))`);
        await queryRunner.query(`CREATE INDEX "IDX_072bd2a36af495f0beaafd7e1e" ON "tb_usuario_rol" ("id_usuario") `);
        await queryRunner.query(`CREATE INDEX "IDX_49a7cc9fe7ec6bf99b7f43453e" ON "tb_usuario_rol" ("id_rol") `);
        await queryRunner.query(`ALTER TABLE "tb_usuario_rol" ADD CONSTRAINT "FK_072bd2a36af495f0beaafd7e1ef" FOREIGN KEY ("id_usuario") REFERENCES "tb_usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "tb_usuario_rol" ADD CONSTRAINT "FK_49a7cc9fe7ec6bf99b7f43453e8" FOREIGN KEY ("id_rol") REFERENCES "tb_rol"("id_rol") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_usuario_rol" DROP CONSTRAINT "FK_49a7cc9fe7ec6bf99b7f43453e8"`);
        await queryRunner.query(`ALTER TABLE "tb_usuario_rol" DROP CONSTRAINT "FK_072bd2a36af495f0beaafd7e1ef"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_49a7cc9fe7ec6bf99b7f43453e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_072bd2a36af495f0beaafd7e1e"`);
        await queryRunner.query(`DROP TABLE "tb_usuario_rol"`);
    }

}
