import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Esquema inicial de notificaciones. Usa IF NOT EXISTS para convivir con
 * bases donde la tabla ya fue creada manualmente; los ALTER agregan las
 * columnas nuevas (reintentos con backoff y borrado lógico).
 */
export class InitNotification1785024000000 implements MigrationInterface {
  name = 'InitNotification1785024000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tb_notification (
        id_notification SERIAL PRIMARY KEY,
        nb_subject      VARCHAR(255) NOT NULL,
        tx_content      TEXT NOT NULL,
        nb_destination  VARCHAR(255) NOT NULL,
        nb_type         VARCHAR(16) NOT NULL,
        ts_scheduled_at TIMESTAMP NULL,
        is_sent         BOOL NOT NULL DEFAULT false,
        nu_attempts     INT NOT NULL DEFAULT 0,
        ts_next_retry_at TIMESTAMP NULL,
        tx_last_error   TEXT NULL,
        tx_client_id    VARCHAR(64) NULL,
        id_user         VARCHAR(64) NULL,
        ts_created_at   TIMESTAMP NOT NULL DEFAULT now(),
        ts_updated_at   TIMESTAMP NOT NULL DEFAULT now(),
        ts_deleted_at   TIMESTAMP NULL
      )
    `);

    await queryRunner.query(
      `ALTER TABLE tb_notification ADD COLUMN IF NOT EXISTS ts_next_retry_at TIMESTAMP NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE tb_notification ADD COLUMN IF NOT EXISTS ts_deleted_at TIMESTAMP NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tb_notification_destination ON tb_notification (nb_destination)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tb_notification_type ON tb_notification (nb_type)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tb_notification_scheduled_at ON tb_notification (ts_scheduled_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tb_notification_is_sent ON tb_notification (is_sent)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tb_notification_next_retry_at ON tb_notification (ts_next_retry_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tb_notification_client_id ON tb_notification (tx_client_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tb_notification_user_id ON tb_notification (id_user)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tb_notification`);
  }
}
