// modules/base-http.module.ts
import { Module } from '@nestjs/common';
import { CarroController } from 'src/api/carro/carro.controller';
import { CarroService } from 'src/api/carro/carro.service';
import { getEnv } from 'src/common/utils/env';
import { Carro } from 'src/database/models/carro.entity';
import { CrudModule } from './crud.module';

@Module({
  imports: [
    CrudModule.forFeature({
      entity: Carro,
      controller: CarroController,
      service: CarroService,
      connectionName: getEnv('DB_NAME'),
    }),
  ],
})
export class BaseHttpModule {}
