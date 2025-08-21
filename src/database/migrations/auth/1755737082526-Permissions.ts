import { MigrationInterface, QueryRunner } from "typeorm";

export class Permissions1755737082526 implements MigrationInterface {
    name = 'Permissions1755737082526'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "tb_rol" ("id_rol" SERIAL NOT NULL, "nb_rol" character varying NOT NULL, "ts_eliminacion" TIMESTAMP, "ts_creacion" TIMESTAMP NOT NULL DEFAULT now(), "ts_actualizacion" TIMESTAMP NOT NULL DEFAULT now(), "id_cliente" uuid NOT NULL, CONSTRAINT "UQ_1e33e550ac04053f0c211687364" UNIQUE ("nb_rol"), CONSTRAINT "PK_eec239ccec52711e9dc55099a23" PRIMARY KEY ("id_rol"))`);
        await queryRunner.query(`CREATE TABLE "tb_permiso" ("id_permiso" SERIAL NOT NULL, "co_permiso" character varying NOT NULL, "ts_creacion" TIMESTAMP NOT NULL DEFAULT now(), "ts_actualizacion" TIMESTAMP NOT NULL DEFAULT now(), "ts_eliminacion" TIMESTAMP, "id_cliente" uuid NOT NULL, CONSTRAINT "UQ_66ce5fe7e11c7d28c38202f40d4" UNIQUE ("co_permiso"), CONSTRAINT "PK_bd6e257513288734e04c409a475" PRIMARY KEY ("id_permiso"))`);
        await queryRunner.query(`ALTER TABLE "tb_usuario" DROP COLUMN "st_usuario"`);
        await queryRunner.query(`ALTER TABLE "tb_cliente" ADD "ts_eliminacion" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "tb_usuario" ADD "is_email_verificado" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "tb_usuario" ADD "ts_eliminacion" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "tb_usuario" ADD "json_atributos" json DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "tb_rol" ADD CONSTRAINT "FK_f82ecb3ad21d60a8bb23d9dbfb3" FOREIGN KEY ("id_cliente") REFERENCES "tb_cliente"("id_cliente") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "tb_permiso" ADD CONSTRAINT "FK_3bf2edd6130af3270146b045892" FOREIGN KEY ("id_cliente") REFERENCES "tb_cliente"("id_cliente") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_permiso" DROP CONSTRAINT "FK_3bf2edd6130af3270146b045892"`);
        await queryRunner.query(`ALTER TABLE "tb_rol" DROP CONSTRAINT "FK_f82ecb3ad21d60a8bb23d9dbfb3"`);
        await queryRunner.query(`ALTER TABLE "tb_usuario" DROP COLUMN "json_atributos"`);
        await queryRunner.query(`ALTER TABLE "tb_usuario" DROP COLUMN "ts_eliminacion"`);
        await queryRunner.query(`ALTER TABLE "tb_usuario" DROP COLUMN "is_email_verificado"`);
        await queryRunner.query(`ALTER TABLE "tb_cliente" DROP COLUMN "ts_eliminacion"`);
        await queryRunner.query(`ALTER TABLE "tb_usuario" ADD "st_usuario" character varying NOT NULL DEFAULT 'ACTIVO'`);
        await queryRunner.query(`DROP TABLE "tb_permiso"`);
        await queryRunner.query(`DROP TABLE "tb_rol"`);
    }

}
