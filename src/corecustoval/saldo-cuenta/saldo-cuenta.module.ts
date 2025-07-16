import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getEnv } from 'src/common/utils/env';
import { SaldoCuenta } from 'src/database/models/saldo-cuenta.entity';
import { SaldoCuentaService } from './saldo-cuenta.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SaldoCuenta], getEnv('DB_NAME')),
  ],
  providers: [SaldoCuentaService],
  exports: [SaldoCuentaService],
})
export class CuentaModule {}
