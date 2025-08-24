import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TokenAccesoService } from './token-acceso.service';
import { Logger as AppLogger } from 'src/common/services/logger.service';

@Injectable()
export class TokenCleanupService {
  constructor(
    private readonly tokenService: TokenAccesoService,
    private readonly logger: AppLogger,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async revokeExpiredTokens(): Promise<void> {
    this.logger.info(`Revoking expired tokens...`, TokenCleanupService.name);
    const now = new Date();
    const affected = await this.tokenService.revokeExpired(now);
    if (affected > 0) {
      this.logger.info(`Revoked ${affected} expired tokens`, TokenCleanupService.name);
    }
  }
}
