import { MigrationInterface, QueryRunner } from "typeorm";

export class TbTokenAcceso1755916024926 implements MigrationInterface {
    name = 'TbTokenAcceso1755916024926'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "tb_token_acceso" ("id_token_acceso" SERIAL NOT NULL, "tx_jid" character varying NOT NULL, "id_usuario" integer NOT NULL, "id_cliente" uuid NOT NULL, "is_revocado" boolean NOT NULL DEFAULT false, "ts_expiracion" TIMESTAMP NOT NULL, "ts_creacion" TIMESTAMP NOT NULL DEFAULT now(), "ts_actualizacion" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_2ebd6e69c804bc181e9bfaca56d" UNIQUE ("tx_jid"), CONSTRAINT "PK_0ef175933101ac049e2313a5545" PRIMARY KEY ("id_token_acceso"))`);
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" ADD CONSTRAINT "FK_c86b069faee599ee815bdeb9511" FOREIGN KEY ("id_usuario") REFERENCES "tb_usuario"("id_usuario") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" ADD CONSTRAINT "FK_0fefbce18916b4eb3a000f421e1" FOREIGN KEY ("id_cliente") REFERENCES "tb_cliente"("id_cliente") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" DROP CONSTRAINT "FK_0fefbce18916b4eb3a000f421e1"`);
        await queryRunner.query(`ALTER TABLE "tb_token_acceso" DROP CONSTRAINT "FK_c86b069faee599ee815bdeb9511"`);
        await queryRunner.query(`DROP TABLE "tb_token_acceso"`);
    }

}
