import { Injectable } from '@nestjs/common';
import { b64ToBytes, bytesToB64, Envelope, randomBytes, toArrayBuffer, subtle } from './crypto.utils';
import { KeyStoreService } from './keystore.service';

@Injectable()
export class CryptoService {
  constructor(private readonly ks: KeyStoreService) {}

  async unwrapAesKey(ekB64: string): Promise<CryptoKey> {
    // ek = AES-raw cifrada con RSA-OAEP (base64)
    const ekBytes = b64ToBytes(ekB64);
    const aesRaw = new Uint8Array(
      await subtle.decrypt({ name: 'RSA-OAEP' }, this.ks.getPrivateKey(), toArrayBuffer(ekBytes))
    );
    return subtle.importKey(
      'raw',
      toArrayBuffer(aesRaw),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async decryptEnvelope(env: Envelope): Promise<{ nonce: string; aesKey: CryptoKey; plain: any }> {
    const aesKey = await this.unwrapAesKey(env.ek);
    const iv = b64ToBytes(env.iv);
    const data = b64ToBytes(env.data);

    const plainBuf = await subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, aesKey, toArrayBuffer(data));
    const plainStr = Buffer.from(new Uint8Array(plainBuf)).toString('utf8');
    const plain = JSON.parse(plainStr);
    return { nonce: env.nonce, aesKey, plain };
  }

  async encryptResponse(aesKey: CryptoKey, nonce: string, payload: any): Promise<Pick<Envelope, 'iv'|'data'|'nonce'>> {
    const iv = randomBytes(12);
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const cipher = await subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, aesKey, toArrayBuffer(new Uint8Array(raw)));
    return {
      iv: bytesToB64(iv),
      data: bytesToB64(new Uint8Array(cipher)),
      nonce,
    };
  }
}
