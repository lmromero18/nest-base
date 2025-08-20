import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUserTable1755723109687 implements MigrationInterface {
    name = 'CreateUserTable1755723109687'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "tb_user" ("id_user" SERIAL NOT NULL, "tx_username" character varying NOT NULL, "tx_password" character varying NOT NULL, CONSTRAINT "UQ_dcc1d6e2ead0f82098820328875" UNIQUE ("tx_username"), CONSTRAINT "PK_5c3a6c23c570ba478c95002cdc7" PRIMARY KEY ("id_user"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "tb_user"`);
    }

}
