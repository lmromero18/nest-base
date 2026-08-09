import { DataSource } from 'typeorm';
import { ExistingEntity } from './existing.entity';

export default new DataSource({
  type: 'postgres',
  entities: [ExistingEntity],
  migrations: ['src/config/database/migrations/*.ts'],
});
