import { Controller, Get, Optional } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckError,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';
import { DATABASE_CONNECTIONS } from '../../config/database/database.constants';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller({
  path: 'health',
})
@Public()
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    // Optional: permite montar el módulo sin conexión (tests aislados)
    @Optional()
    @InjectDataSource(DATABASE_CONNECTIONS.BASE)
    private readonly dataSource?: DataSource,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Estado del servicio (sin tocar dependencias)' })
  check() {
    return this.healthService.check();
  }

  @Get('db')
  @HealthCheck()
  @ApiOperation({ summary: 'Conectividad real contra la base de datos' })
  checkDatabase() {
    return this.health.check([
      () => {
        if (!this.dataSource) {
          throw new HealthCheckError('database', {
            database: {
              status: 'down',
              message: 'Sin conexión de base de datos registrada',
            },
          });
        }
        return this.db.pingCheck('database', {
          connection: this.dataSource,
          timeout: 3000,
        });
      },
    ]);
  }
}
