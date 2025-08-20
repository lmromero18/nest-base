import 'dotenv/config';
import { join } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { createDataSourceOptions, loadDbConfig } from '../common/utils/db-config';
import { getEnv } from '../common/utils/env';

let cliDataSource: DataSource;

const mainOptions = createDataSourceOptions(loadDbConfig(
  'DB_',
  getEnv('DB_NAME'),
  join(__dirname, 'migrations/main/*{.ts,.js}'),
  join(__dirname, '**', '*.entity.{ts,.js}'),
));

const secondaryOptions = createDataSourceOptions(loadDbConfig(
  'DB_SECONDARY_',
  getEnv('DB_SECONDARY_NAME'),
  join(__dirname, 'migrations/secondary/*{.ts,.js}'),
  join(__dirname, '**', '*.entity.{ts,.js}'),
));

const options: DataSourceOptions[] = [
  mainOptions,
  secondaryOptions,
];

export const appDataSourceOptions: DataSourceOptions[] = options;

switch (process.env.DATASOURCE_NAME) {
  case 'secondary':
    cliDataSource = new DataSource(secondaryOptions);
    break;
  case 'main':
  default:
    cliDataSource = new DataSource(mainOptions);
    break;
}

export default cliDataSource;