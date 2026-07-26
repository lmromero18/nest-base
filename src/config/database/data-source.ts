import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Notification } from '../../modules/notification/notification.entity';
import { basePostgresOptions } from './database.config';

/**
 * DataSource para el CLI de TypeORM (migraciones). La app usa DatabaseModule.
 *
 *   bun run migration:run
 *   bun run migration:generate src/config/database/migrations/NombreCambio
 */
export default new DataSource({
  ...basePostgresOptions('DB_BASE'),
  entities: [Notification],
  migrations: ['src/config/database/migrations/*.ts'],
});
