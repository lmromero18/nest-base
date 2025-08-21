import { MigrationInterface, QueryRunner } from "typeorm";

export class ToSpanish1755734319895 implements MigrationInterface {
    name = 'ToSpanish1755734319895'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "tb_cliente" ("id_cliente" uuid NOT NULL DEFAULT uuid_generate_v4(), "nb_cliente" character varying NOT NULL, CONSTRAINT "UQ_aab36aa0b882cc1378a681a28dc" UNIQUE ("nb_cliente"), CONSTRAINT "PK_26bbe2adb948990b0d178dad803" PRIMARY KEY ("id_cliente"))`);
        await queryRunner.query(`CREATE TABLE "tb_usuario" ("id_usuario" SERIAL NOT NULL, "nb_username" character varying NOT NULL, "tx_contrasena" character varying NOT NULL, "tx_correo" character varying NOT NULL, "id_cliente" uuid NOT NULL, CONSTRAINT "UQ_0a041a7f1311be1580c6ba5abc4" UNIQUE ("nb_username"), CONSTRAINT "UQ_0b8c8d25828f3638745f5381400" UNIQUE ("tx_correo"), CONSTRAINT "PK_f43877d972cd19084cead63461d" PRIMARY KEY ("id_usuario"))`);
        await queryRunner.query(`ALTER TABLE "tb_usuario" ADD CONSTRAINT "FK_4eaaf1129d3eede1007258839ac" FOREIGN KEY ("id_cliente") REFERENCES "tb_cliente"("id_cliente") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_usuario" DROP CONSTRAINT "FK_4eaaf1129d3eede1007258839ac"`);
        await queryRunner.query(`DROP TABLE "tb_usuario"`);
        await queryRunner.query(`DROP TABLE "tb_cliente"`);
    }

}
