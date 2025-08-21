import { Controller } from '@nestjs/common';
import { BaseController } from 'src/common/controllers/base.controller';
import { ClienteService } from './cliente.service';
import { Cliente } from './cliente.entity';

@Controller('cliente')
export class ClienteController extends BaseController<Cliente> {
  constructor(private readonly clienteService: ClienteService) {
    super(clienteService);
  }
}
