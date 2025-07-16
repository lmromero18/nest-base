import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getEnv } from 'src/common/utils/env';
import { Cuenta } from 'src/database/models/cuenta.entity';
import { SaldoCuenta } from 'src/database/models/saldo-cuenta.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      name: getEnv('DB_NAME'),
      useFactory: () => ({
        type: 'postgres',
        host: getEnv('DB_HOST'),
        port: parseInt(getEnv('DB_PORT')),
        username: getEnv('DB_USERNAME'),
        password: getEnv('DB_PASSWORD'),
        database: getEnv('DB_DATABASE'),
        schema: getEnv('DB_SCHEMA'),
        entityPrefix: getEnv('DB_PREFIX', ''),
        logging: getEnv('DB_LOGGING', 'false') === 'true',
        synchronize: getEnv('DB_SYNCHRONIZE', 'false') === 'true',
        entities: [Cuenta, SaldoCuenta],
      }),
    }),

    TypeOrmModule.forFeature([Cuenta, SaldoCuenta], getEnv('DB_NAME')),
  ],
  exports: [TypeOrmModule],
})
export class CorecustovalModule {}
