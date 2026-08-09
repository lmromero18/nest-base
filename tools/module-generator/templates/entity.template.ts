import type { NameModel } from '../generator';

export function renderEntityTemplate(name: NameModel): string {
  const columnPrefix = name.moduleName.replaceAll('-', '_');

  return `import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { getEnv } from '../../common/utils/env';

@Entity({
  name: '${name.tableName}',
  schema: getEnv('DB_BASE_SCHEMA', 'public'),
})
export class ${name.entityName} {
  @PrimaryGeneratedColumn({ name: 'id_${columnPrefix}', type: 'int' })
  id!: number;

  @Column({ type: 'varchar', length: 255, name: 'nb_name' })
  name!: string;

  @CreateDateColumn({ name: 'ts_created_at' })
  tsCreatedAt!: Date;

  @UpdateDateColumn({ name: 'ts_updated_at' })
  tsUpdatedAt!: Date;

  @DeleteDateColumn({ name: 'ts_deleted_at' })
  tsDeletedAt?: Date | null;
}
`;
}
