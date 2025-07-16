import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getEnv } from 'src/common/utils/env';
import { Cuenta } from 'src/database/models/cuenta.entity';
import { CuentaService } from './cuenta.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Cuenta], getEnv('DB_NAME')),
  ],
  providers: [CuentaService],
  exports: [CuentaService],
})
export class CuentaModule {}
