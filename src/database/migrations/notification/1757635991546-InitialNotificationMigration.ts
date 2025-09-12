import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialNotificationMigration1757635991546 implements MigrationInterface {
    name = 'InitialNotificationMigration1757635991546'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "tb_notification" ("id_notification" SERIAL NOT NULL, "nb_subject" character varying(255) NOT NULL, "tx_content" text NOT NULL, "nb_destination" character varying(255) NOT NULL, "nb_type" character varying(16) NOT NULL, "ts_scheduled_at" TIMESTAMP, "is_sent" boolean NOT NULL DEFAULT false, "nu_attempts" integer NOT NULL DEFAULT '0', "tx_last_error" text, "tx_client_id" character varying(64), "id_user" character varying(64), "ts_created_at" TIMESTAMP NOT NULL DEFAULT now(), "ts_updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_75e6ffa77d20246a6ebc2bcbd63" PRIMARY KEY ("id_notification"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e00e5b1a2e4baa1a7faf3cd7e8" ON "tb_notification" ("nb_destination") `);
        await queryRunner.query(`CREATE INDEX "IDX_b6bf4c0c5647955470f71c405f" ON "tb_notification" ("nb_type") `);
        await queryRunner.query(`CREATE INDEX "IDX_30be3b42820041be3c630dea98" ON "tb_notification" ("ts_scheduled_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_fbc33a180c89205e2632705321" ON "tb_notification" ("is_sent") `);
        await queryRunner.query(`CREATE INDEX "IDX_c195b1d9e9e62d5d1797c0c80f" ON "tb_notification" ("tx_client_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_552f39c056e9027098b71ba338" ON "tb_notification" ("id_user") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_552f39c056e9027098b71ba338"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c195b1d9e9e62d5d1797c0c80f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fbc33a180c89205e2632705321"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_30be3b42820041be3c630dea98"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b6bf4c0c5647955470f71c405f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e00e5b1a2e4baa1a7faf3cd7e8"`);
        await queryRunner.query(`DROP TABLE "tb_notification"`);
    }

}
