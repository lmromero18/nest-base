import { Controller, Get } from '@nestjs/common';
import { KeyStoreService } from './keystore.service';

@Controller('crypto')
export class CryptoController {
  constructor(private readonly ks: KeyStoreService) {}

  @Get('public-key')
  getPublicKey(): JsonWebKey {
    return this.ks.getPublicJwk();
  }
}
