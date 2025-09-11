import {
  Body,
  Controller,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Cliente } from './cliente.entity';
import { ClienteService } from './cliente.service';

@Controller('auth/cliente')
export class ClienteController {
  constructor(private readonly clienteService: ClienteService) {}

  @Post()
  async create(@Body() data: Cliente) {
    try {
      return await this.clienteService.create(data);
    } catch (e) {
      throw new UnprocessableEntityException('Error al crear');
    }
  }
}
