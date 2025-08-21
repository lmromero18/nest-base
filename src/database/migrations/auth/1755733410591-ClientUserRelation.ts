import { MigrationInterface, QueryRunner } from "typeorm";

export class ClientUserRelation1755733410591 implements MigrationInterface {
    name = 'ClientUserRelation1755733410591'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_user" ADD "tx_email" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "tb_user" ADD CONSTRAINT "UQ_8a7d8866a9f259f6fcea76a6c26" UNIQUE ("tx_email")`);
        await queryRunner.query(`ALTER TABLE "tb_user" ADD "id_client" uuid NOT NULL`);
        await queryRunner.query(`ALTER TABLE "tb_user" ADD CONSTRAINT "FK_3fd6032fb79301a2824a8cb3c03" FOREIGN KEY ("id_client") REFERENCES "tb_client"("id_client") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_user" DROP CONSTRAINT "FK_3fd6032fb79301a2824a8cb3c03"`);
        await queryRunner.query(`ALTER TABLE "tb_user" DROP COLUMN "id_client"`);
        await queryRunner.query(`ALTER TABLE "tb_user" DROP CONSTRAINT "UQ_8a7d8866a9f259f6fcea76a6c26"`);
        await queryRunner.query(`ALTER TABLE "tb_user" DROP COLUMN "tx_email"`);
    }

}
