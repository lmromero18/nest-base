import { Injectable, OnModuleInit } from '@nestjs/common';
import { subtle } from './crypto.utils';

@Injectable()
export class KeyStoreService implements OnModuleInit {
  private publicKey!: CryptoKey;
  private privateKey!: CryptoKey;
  private publicJwk!: JsonWebKey;

  async onModuleInit() {
    const { publicKey, privateKey } = await subtle.generateKey(
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256',
        modulusLength: 2048,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      },
      true,
      ['encrypt', 'decrypt']
    );
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    this.publicJwk = await subtle.exportKey('jwk', publicKey);
    this.publicJwk.key_ops = ['encrypt'];
  }

  getPublicJwk(): JsonWebKey {
    return this.publicJwk;
  }

  getPrivateKey(): CryptoKey {
    return this.privateKey;
  }

  getPublicKey(): CryptoKey {
    return this.publicKey;
  }
}
