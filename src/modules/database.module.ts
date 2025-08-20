// common/modules/database.module.ts
import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

export type DbConnName = string;

export interface DbEnvConfig {
  name: DbConnName;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  schema?: string;
  prefix?: string;
  logging?: boolean;
  synchronize?: boolean;
  entities?: any[];
}

@Module({})
export class DatabaseModule {
  /**
   * Registra varias conexiones (forRootAsync) de una sola vez.
   * Puedes (opcionalmente) pasar entities por conexión si quieres cargarlas aquí.
   */
  static forConnections(configs: DbEnvConfig[]): DynamicModule {
    const imports = configs.map((cfg) =>
      TypeOrmModule.forRootAsync({
        name: cfg.name,
        useFactory: () => ({
          type: 'postgres',
          host: cfg.host,
          port: cfg.port,
          username: cfg.username,
          password: cfg.password,
          database: cfg.database,
          schema: cfg.schema,
          entityPrefix: cfg.prefix ?? '',
          logging: cfg.logging ?? false,
          synchronize: cfg.synchronize ?? false,
          entities: cfg.entities ?? [],
        }),
      }),
    );

    return {
      module: DatabaseModule,
      imports,
      exports: imports,
    };
  }

  /**
   * Registro de entidades para una conexión específica (azúcar sintáctico).
   */
  static forEntities(
    connectionName: DbConnName,
    entities: any[],
  ): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [TypeOrmModule.forFeature(entities, connectionName)],
      exports: [TypeOrmModule],
    };
  }
}
