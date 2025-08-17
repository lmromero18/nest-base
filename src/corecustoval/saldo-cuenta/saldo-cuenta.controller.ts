import { Controller, Get, Param, Query } from '@nestjs/common';
import { SaldoCuentaService } from '../saldo-cuenta/saldo-cuenta.service';
import { BaseController } from 'src/common/controllers/base.controller';
import { SaldoCuenta } from 'src/database/models/saldo-cuenta.entity';

@Controller('saldo-cuenta')
export class SaldoCuentaController extends BaseController<SaldoCuenta> {
  constructor(private readonly saldoCuentaService: SaldoCuentaService) {
    super(saldoCuentaService);
  }

  @Get('saldo/:co_participante/:co_identificacion')
  async getSaldoCuenta(
    @Param('co_participante') co_participante: string,
    @Param('co_identificacion') co_identificacion: string,
    @Query() query: any,
  ) {
    if (!co_participante || !co_identificacion) {
      return {
        status: 'error',
        message: 'Datos incorrectos',
      };
    }

    const filters = {
      ...query,
      co_participante,
      co_identificacion,
    };

    const { page = 1, limit = 10 } = query;

    return await this.saldoCuentaService.find(Number(page), Number(limit), filters);
  }
}
