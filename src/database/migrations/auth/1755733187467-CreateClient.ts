import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateClient1755733187467 implements MigrationInterface {
    name = 'CreateClient1755733187467'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "tb_client" ("id_client" uuid NOT NULL DEFAULT uuid_generate_v4(), "nb_client" character varying NOT NULL, CONSTRAINT "UQ_93dab32b4a30e8d6161ef791fac" UNIQUE ("nb_client"), CONSTRAINT "PK_a08b0cee357d346fd6086cbd6ef" PRIMARY KEY ("id_client"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "tb_client"`);
    }

}
