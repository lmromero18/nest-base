import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BaseService } from 'src/common/services/base.service';
import { getEnv } from 'src/common/utils/env';
import { Cuenta } from 'src/database/models/cuenta.entity';
import { Repository } from 'typeorm';

@Injectable()
export class CuentaService extends BaseService<Cuenta> {
  constructor(
    @InjectRepository(Cuenta, getEnv('DB_NAME'))
    private readonly cuentaRepository: Repository<Cuenta>,
  ) {
    super(cuentaRepository);
  }
}
