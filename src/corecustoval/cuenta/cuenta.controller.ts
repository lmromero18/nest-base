import { Controller, Get, Param, Query } from '@nestjs/common';
import { CuentaService } from './cuenta.service';
import { Logger } from 'src/common/services/logger.service';

@Controller('cuenta')
export class CuentaController {
    constructor(private readonly cuentaService: CuentaService, private readonly logger: Logger) { }

    @Get(':co_participante/:co_identificacion')
    async getCuenta(
        @Param('co_participante') co_participante: string,
        @Param('co_identificacion') co_identificacion: string,
        @Query() query: any
    ) {
        this.logger.setContext(CuentaController.name);
        this.logger.info('Datos incorrectos', {
            co_participante,
            co_identificacion,
            query,
        });
        
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

        return await this.cuentaService.find(Number(page), Number(limit), filters);

    }
}
