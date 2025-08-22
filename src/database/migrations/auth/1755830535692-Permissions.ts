import { MigrationInterface, QueryRunner } from "typeorm";

export class Permissions1755830535692 implements MigrationInterface {
    name = 'Permissions1755830535692'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "tb_rol_permiso" ("id_rol" integer NOT NULL, "id_permiso" integer NOT NULL, CONSTRAINT "PK_c57a994122071dcffb9f9b8cd63" PRIMARY KEY ("id_rol", "id_permiso"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5795087a0a90eb80bc5ccf64f5" ON "tb_rol_permiso" ("id_rol") `);
        await queryRunner.query(`CREATE INDEX "IDX_dcecdf171b23668bf2f833f31a" ON "tb_rol_permiso" ("id_permiso") `);
        await queryRunner.query(`ALTER TABLE "tb_rol_permiso" ADD CONSTRAINT "FK_5795087a0a90eb80bc5ccf64f53" FOREIGN KEY ("id_rol") REFERENCES "tb_rol"("id_rol") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "tb_rol_permiso" ADD CONSTRAINT "FK_dcecdf171b23668bf2f833f31a7" FOREIGN KEY ("id_permiso") REFERENCES "tb_permiso"("id_permiso") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_rol_permiso" DROP CONSTRAINT "FK_dcecdf171b23668bf2f833f31a7"`);
        await queryRunner.query(`ALTER TABLE "tb_rol_permiso" DROP CONSTRAINT "FK_5795087a0a90eb80bc5ccf64f53"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dcecdf171b23668bf2f833f31a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5795087a0a90eb80bc5ccf64f5"`);
        await queryRunner.query(`DROP TABLE "tb_rol_permiso"`);
    }

}
