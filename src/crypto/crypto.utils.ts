import { webcrypto } from 'crypto';

export const subtle = webcrypto.subtle;

export type Envelope = {
  iv: string;    // base64
  data: string;  // base64
  ek: string;    // base64 (AES-raw envuelta con RSA-OAEP)
  nonce: string; // base64url
};

export function bytesToB64(u8: Uint8Array): string {
  return Buffer.from(u8).toString('base64');
}
export function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function toB64url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export function fromB64url(b64url: string): string {
  const pad = (s: string) => s + '==='.slice((s.length + 3) % 4);
  return pad(b64url.replace(/-/g, '+').replace(/_/g, '/'));
}

export function randomBytes(len: number): Uint8Array {
  const a = new Uint8Array(len);
  webcrypto.getRandomValues(a);
  return a;
}

export function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return ab;
}
