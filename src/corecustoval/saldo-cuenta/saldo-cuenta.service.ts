import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BaseService } from 'src/common/services/base.service';
import { getEnv } from 'src/common/utils/env';
import { Cuenta } from 'src/database/models/cuenta.entity';
import { SaldoCuenta } from 'src/database/models/saldo-cuenta.entity';
import { Repository } from 'typeorm';

@Injectable()
export class SaldoCuentaService extends BaseService<SaldoCuenta> {
  constructor(
    @InjectRepository(SaldoCuenta, getEnv('DB_NAME'))
    private readonly saldoCuentaRepository: Repository<SaldoCuenta>,
  ) {
    super(saldoCuentaRepository);
  }
}
