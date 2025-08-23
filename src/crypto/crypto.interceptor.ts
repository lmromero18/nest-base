import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { Observable, of, from, throwError, defer } from 'rxjs';
import { switchMap, tap, catchError, map } from 'rxjs/operators';
import { CryptoService } from './crypto.service';
import type { Envelope } from './crypto.utils';

// Header names used to indicate/request encryption
const REQ_ENC_HEADERS = ['x-enc', 'x-encrypted'] as const;
const RES_HEADER_ENC = 'X-Enc';
const RES_HEADER_NONCE = 'X-Nonce';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH']);

function isEnvelopeLike(b: unknown): b is Envelope {
  return (
    !!b &&
    typeof b === 'object' &&
    typeof (b as any).iv === 'string' &&
    typeof (b as any).data === 'string' &&
    typeof (b as any).ek === 'string' &&
    typeof (b as any).nonce === 'string'
  );
}

@Injectable()
export class CryptoInterceptor implements NestInterceptor {
  constructor(private readonly crypto: CryptoService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const res = ctx.switchToHttp().getResponse<FastifyReply>();

    const method = (req.method || '').toUpperCase();
    const encFlag = this.getEncHeader(req);
    const body = (req as any).body as unknown;

    // If not an encrypted, mutating request → pass-through.
    const shouldDecrypt =
      encFlag && MUTATING_METHODS.has(method) && isEnvelopeLike(body);
    if (!shouldDecrypt) return next.handle();

    let aesKey: CryptoKey | undefined;
    let nonce = '';

    // 1) Decrypt request body in a defer to avoid eager execution.
    const prepared$ = defer(() =>
      this.crypto.decryptEnvelope(body as Envelope),
    ).pipe(
      tap(({ aesKey: k, nonce: n, plain }) => {
        aesKey = k; // cache for response encryption
        nonce = n;
        (req as any).body = plain; // replace body with plaintext
      }),
    );

    // 2) Proceed with handler, encrypt success payloads. 3) Encrypt errors when possible.
    return prepared$.pipe(
      switchMap(() => next.handle()),
      switchMap((data) => this.maybeEncrypt(res, aesKey, nonce, data)),
      catchError((err) => this.maybeEncryptError(res, aesKey, nonce, err)),
    );
  }

  // Extract 'x-enc' style header value; treat '1' or 'true' (case-insensitive) as enabled
  private getEncHeader(req: FastifyRequest): boolean {
    const value = REQ_ENC_HEADERS.map(
      (h) => req.headers[h] as string | undefined,
    ).find(Boolean);
    if (!value) return false;
    return value === '1' || value.toLowerCase?.() === 'true';
  }

  private setEncResponseHeaders(res: FastifyReply, nonce: string) {
    res.header(RES_HEADER_ENC, '1');
    res.header(RES_HEADER_NONCE, nonce);
  }

  private maybeEncrypt(
    res: FastifyReply,
    aesKey: CryptoKey | undefined,
    nonce: string,
    data: any,
  ): Observable<any> {
    if (!aesKey) return of(data);
    return from(this.crypto.encryptResponse(aesKey, nonce, data)).pipe(
      tap(() => this.setEncResponseHeaders(res, nonce)),
      map((env) => env),
    );
  }

  private maybeEncryptError(
    res: FastifyReply,
    aesKey: CryptoKey | undefined,
    nonce: string,
    err: any,
  ): Observable<never | any> {
    if (!aesKey) return throwError(() => err);
    const status = (err?.status ?? err?.statusCode ?? 500) as number;
    const payload = err?.response ?? {
      message: err?.message ?? 'Internal Server Error',
    };

    return from(this.crypto.encryptResponse(aesKey, nonce, payload)).pipe(
      tap(() => {
        this.setEncResponseHeaders(res, nonce);
        res.status(status);
      }),
      map((env) => env),
    );
  }
}
