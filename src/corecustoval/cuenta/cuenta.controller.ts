import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CuentaService } from './cuenta.service';
import { Logger } from 'src/common/services/logger.service';
import { SaldoCuenta } from 'src/database/models/saldo-cuenta.entity';
import { DeepPartial } from 'typeorm';

@Controller('cuenta')
export class CuentaController {
    constructor(private readonly cuentaService: CuentaService, private readonly logger: Logger) { }

    @Post()
    async createHola(@Body() _data: DeepPartial<SaldoCuenta>) {
        try {
            return {
                status: 'success',
                data: {
                    id: 10,
                    title: 'Post 10',
                    content: 'Contenido del post 10',
                },
            };
        } catch (e) {
            throw new HttpException(
                {
                    status: 'error',
                    message: 'Error al crear',
                    error: e.message,
                },
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    @Get(':co_participante/:co_identificacion')
    async getCuenta(
        @Param('co_participante') co_participante: string,
        @Param('co_identificacion') co_identificacion: string,
        @Query() query: any
    ) {
        this.logger.setContext(CuentaController.name);
        this.logger.info(
            'Datos incorrectos: ' +
            JSON.stringify({ co_participante, co_identificacion, query })
        );

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
