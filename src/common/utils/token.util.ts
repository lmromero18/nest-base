import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Extrae el token Bearer del header Authorization.
 * Retorna el token o lanza error si no está presente o el formato es inválido.
 */
export function extractBearerToken(authorizationHeader?: string): string {
  if (!authorizationHeader) {
    throw new Error('TOKEN_MISSING');
  }

  const [scheme, token] = authorizationHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new Error('TOKEN_MISSING');
  }

  return token;
}

/**
 * Decodifica el payload de un JWT SIN verificar la firma.
 *
 * ADVERTENCIA: solo para introspección/debug de tokens ya verificados.
 * Nunca usar como mecanismo de autenticación: la verificación de firma
 * vive en JwtAuthGuard.
 */
export function decodeTokenPayload(token: string): JwtPayload {
  const [, encodedPayload] = token.split('.');

  if (!encodedPayload) {
    throw new Error('TOKEN_INVALID');
  }

  try {
    const decoded = decodeBase64Url(encodedPayload).toString('utf8');
    return JSON.parse(decoded) as JwtPayload;
  } catch {
    throw new Error('TOKEN_INVALID');
  }
}

/**
 * Decodifica un string en base64url a Buffer.
 */
export function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');

  return Buffer.from(padded, 'base64');
}
