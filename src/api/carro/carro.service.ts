import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BaseService } from 'src/common/services/base.service';
import { getEnv } from 'src/common/utils/env';
import { Carro } from 'src/database/models/carro.entity';
import { Repository } from 'typeorm';

@Injectable()
export class CarroService extends BaseService<Carro> {
  constructor(
    @InjectRepository(Carro, getEnv('DB_NAME'))
    private readonly carroRepository: Repository<Carro>,
  ) {
    super(carroRepository);
  }
}
