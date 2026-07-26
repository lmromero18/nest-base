import { Injectable } from '@nestjs/common';
import { getEnv } from '../../common/utils/env';
import { version } from '../../../package.json';

@Injectable()
export class HealthService {
  check() {
    return {
      status: 'OK',
      service: getEnv('APP_NAME', 'NEST-BASE'),
      version,
      environment: getEnv('NODE_ENV', 'local'),
      timestamp: new Date().toISOString(),
    };
  }
}
