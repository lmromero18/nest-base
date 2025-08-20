import { Controller, Get } from '@nestjs/common';
import { KeyStoreService } from './keystore.service';
import { Public } from 'src/auth/auth.decorator';

@Public()
@Controller('crypto')
export class CryptoController {
  constructor(private readonly ks: KeyStoreService) {}

  @Get('public-key')
  getPublicKey(): JsonWebKey {
    return this.ks.getPublicJwk();
  }
}
