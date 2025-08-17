import { Injectable, OnModuleInit } from '@nestjs/common';
import { subtle } from './crypto.utils';

@Injectable()
export class KeyStoreService implements OnModuleInit {
  private publicKey!: CryptoKey;
  private privateKey!: CryptoKey;
  private publicJwk!: JsonWebKey;

  async onModuleInit() {
    // Genera par RSA-OAEP (puedes cambiar a 4096 si quieres)
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
    // Opcional: añade alg/usage visibles
    this.publicJwk.key_ops = ['encrypt'];
    // this.publicJwk.alg = 'RSA-OAEP-256'; // Node puede no setearlo; el cliente no lo requiere estrictamente
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
