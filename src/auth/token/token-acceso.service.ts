import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getEnv } from 'src/common/utils/env';
import { BaseService } from 'src/common/services/base.service';
import { TokenAcceso } from './token-acceso.entity';
import { Logger as AppLogger } from 'src/common/services/logger.service';

@Injectable()
export class TokenAccesoService extends BaseService<TokenAcceso> {

  constructor(
    @InjectRepository(TokenAcceso, getEnv('AUTH_DB_NAME'))
    private readonly tokenRepository: Repository<TokenAcceso>,
  private readonly logger: AppLogger,
  ) {
    super(tokenRepository);
  }

  async revokeByJid(jid: string): Promise<void> {
    await this.tokenRepository.update({ jid }, { isRevocado: true });
  }

  async revokeExpired(now = new Date()): Promise<number> {
    const res = await this.tokenRepository
      .createQueryBuilder()
      .update(TokenAcceso)
      .set({ isRevocado: true })
      .where('is_revocado = :rev', { rev: false })
      .andWhere('ts_expiracion <= :now', { now })
      .execute();
    const affected = res.affected ?? 0;
    if (affected > 0) {
      this.logger.info(`Revoked ${affected} expired tokens.`, TokenAccesoService.name);
    }
    return affected;
  }
}
