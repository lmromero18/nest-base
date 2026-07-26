import { Controller, Get, Logger } from '@nestjs/common';
import { HealthService } from './health.service';
import { Public } from 'src/common/decorators/public.decorator';

@Controller({
  path: 'health',
})
@Public()
export class HealthController {

  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly healthService: HealthService) { }

  @Get()
  check() {
    this.logger.log('Health check ejecutado correctamente');

    return this.healthService.check();
  }
}
