import { MigrationInterface, QueryRunner } from "typeorm";

export class Clientepadre1755734861490 implements MigrationInterface {
    name = 'Clientepadre1755734861490'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_cliente" ADD "id_cliente_padre" uuid`);
        await queryRunner.query(`ALTER TABLE "tb_cliente" ADD CONSTRAINT "FK_b9e455d289affabe680347ad13f" FOREIGN KEY ("id_cliente_padre") REFERENCES "tb_cliente"("id_cliente") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tb_cliente" DROP CONSTRAINT "FK_b9e455d289affabe680347ad13f"`);
        await queryRunner.query(`ALTER TABLE "tb_cliente" DROP COLUMN "id_cliente_padre"`);
    }

}
