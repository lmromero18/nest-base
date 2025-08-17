import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CryptoController } from './crypto.controller';
import { CryptoService } from './crypto.service';
import { KeyStoreService } from './keystore.service';
import { CryptoInterceptor } from './crypto.interceptor';

@Module({
  controllers: [CryptoController],
  providers: [
    KeyStoreService,
    CryptoService,
    { provide: APP_INTERCEPTOR, useClass: CryptoInterceptor },
  ],
  exports: [CryptoService],
})
export class CryptoModule {}
