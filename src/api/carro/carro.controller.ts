import { Controller, Get, Param, Query } from '@nestjs/common';
import { BaseController } from 'src/common/controllers/base.controller';
import { CarroService } from './carro.service';
import { Carro } from 'src/database/models/carro.entity';

@Controller('carro')
export class CarroController extends BaseController<Carro> {
  constructor(private readonly carroService: CarroService) {
    super(carroService);
  }
}
