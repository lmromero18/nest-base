import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';

@Module({})
export class DatabaseModule {
  static forConnections(options: DataSourceOptions[]): DynamicModule {
    const imports = options.map((opt) =>
      TypeOrmModule.forRootAsync({
        name: opt.name,
        useFactory: () => ({
          ...opt,
          autoLoadEntities: true,
          entities: [],
        }),
      }),
    );

    return {
      module: DatabaseModule,
      imports,
      exports: imports,
    };
  }

  static forEntities(connectionName: string, entities: any[]): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [TypeOrmModule.forFeature(entities, connectionName)],
      exports: [TypeOrmModule],
    };
  }
}
