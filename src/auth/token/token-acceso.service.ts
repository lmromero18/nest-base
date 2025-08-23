import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getEnv } from 'src/common/utils/env';
import { BaseService } from 'src/common/services/base.service';
import { TokenAcceso } from './token-acceso.entity';

@Injectable()
export class TokenAccesoService extends BaseService<TokenAcceso> {
  constructor(
    @InjectRepository(TokenAcceso, getEnv('AUTH_DB_NAME'))
    private readonly tokenRepository: Repository<TokenAcceso>,
  ) {
    super(tokenRepository);
  }

  async revokeByJid(jid: string): Promise<void> {
    await this.tokenRepository.update({ jid }, { isRevocado: true });
  }
}
