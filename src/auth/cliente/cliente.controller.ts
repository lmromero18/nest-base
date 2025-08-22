import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { BaseController } from 'src/common/controllers/base.controller';
import { ClienteService } from './cliente.service';
import { Cliente } from './cliente.entity';

@Controller('auth/cliente')
export class ClienteController {
  constructor(private readonly clienteService: ClienteService) {}

  @Post()
  async create(@Body() data: Cliente) {
    try {
      return await this.clienteService.create(data);
    } catch (e) {
      throw new HttpException(
        { status: 'error', message: 'Error al crear', error: e.message },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }
}
