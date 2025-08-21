import { Injectable } from '@nestjs/common';
import { Cliente } from './cliente.entity';
import { BaseService } from 'src/common/services/base.service';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { getEnv } from 'src/common/utils/env';

@Injectable()
export class ClienteService extends BaseService<Cliente> {
  constructor(
    @InjectRepository(Cliente, getEnv('AUTH_DB_NAME'))
    private readonly clienteRepository: Repository<Cliente>,
  ) {
    super(clienteRepository);
  }
}
