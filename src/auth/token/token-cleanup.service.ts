import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TokenAccesoService } from './token-acceso.service';

@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(private readonly tokenService: TokenAccesoService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async revokeExpiredTokens(): Promise<void> {
    this.logger.log(`Revoking expired tokens...`);
    const now = new Date();
    const affected = await this.tokenService.revokeExpired(now);
    if (affected > 0) {
      this.logger.log(`Revoked ${affected} expired tokens`);
    }
  }
}
