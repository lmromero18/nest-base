import { Controller, Get, Param, Query } from '@nestjs/common';
import { SaldoCuentaService } from './saldo-cuenta.service';

@Controller('saldo-cuenta')
export class SaldoCuentaController {
    constructor(private readonly saldoCuentaService: SaldoCuentaService) { }

    @Get('saldo/:co_participante/:co_identificacion')
    async getSaldoCuenta(
        @Param('co_participante') co_participante: string,
        @Param('co_identificacion') co_identificacion: string,
        @Query() query: any
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
