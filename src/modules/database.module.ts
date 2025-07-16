import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({})
export class DatabaseModule {
  static forEntities(connectionName: string, entities: any[]): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forFeature(entities, connectionName),
      ],
      exports: [TypeOrmModule],
    };
  }
}
