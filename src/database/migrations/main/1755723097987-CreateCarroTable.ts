import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCarroTable1755723097987 implements MigrationInterface {
    name = 'CreateCarroTable1755723097987'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "tb_carro" ("id" SERIAL NOT NULL, "nb_marca" character varying(50) NOT NULL, "nb_modelo" character varying(50) NOT NULL, "nu_anio" integer, "mo_monto" numeric(10,2), "is_disponible" boolean DEFAULT true, CONSTRAINT "PK_743659e06336f7775f36883562c" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "tb_carro"`);
    }

}
