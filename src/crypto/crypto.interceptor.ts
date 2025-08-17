import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { Observable, of, from, throwError } from 'rxjs';
import { mergeMap, tap, catchError, mapTo, map } from 'rxjs/operators';
import { CryptoService } from './crypto.service';

type Envelope = {
  iv: string;
  data: string;
  ek: string;
  nonce: string;
};

function looksEnvelope(b: any): b is Envelope {
  return b && typeof b === 'object'
    && typeof b.iv === 'string'
    && typeof b.data === 'string'
    && typeof b.ek === 'string'
    && typeof b.nonce === 'string';
}

@Injectable()
export class CryptoInterceptor implements NestInterceptor {
  constructor(private readonly crypto: CryptoService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const res = ctx.switchToHttp().getResponse<FastifyReply>();

    const method = (req.method || '').toUpperCase();
    const xEnc = (req.headers['x-enc'] ?? req.headers['x-encrypted']) as string | undefined;
    const body = (req as any).body;

    // Si no viene cifrado o no es POST/PUT/PATCH → NO tocar nada (evita el EmptyError en GET)
    const shouldDecrypt = xEnc === '1' && (method === 'POST' || method === 'PUT' || method === 'PATCH') && looksEnvelope(body);
    if (!shouldDecrypt) {
      return next.handle();
    }

    let aesKey: CryptoKey | undefined;
    let nonce = '';

    // 1) Prepara: descifra el body y reemplázalo
    const prepare$ = from(this.crypto.decryptEnvelope(body)).pipe(
      tap(({ aesKey: k, nonce: n, plain }) => {
        aesKey = k;
        nonce = n;
        (req as any).body = plain;
      }),
      mapTo(void 0)
    );

    // 2) Ejecuta handler, cifra respuesta; 3) cifra errores si ocurren
    return prepare$.pipe(
      mergeMap(() => next.handle()),
      mergeMap((data) => {
        if (!aesKey) return of(data);
        return from(this.crypto.encryptResponse(aesKey, nonce, data)).pipe(
          tap(() => {
            res.header('X-Enc', '1');
            res.header('X-Nonce', nonce);
          }),
          map((env) => env),
        );
      }),
      catchError((err) => {
        if (!aesKey) return throwError(() => err);
        const status = (err?.status ?? err?.statusCode ?? 500) as number;
        const payload = err?.response ?? { message: err?.message ?? 'Internal Server Error' };

        return from(this.crypto.encryptResponse(aesKey!, nonce, payload)).pipe(
          tap(() => {
            res.header('X-Enc', '1');
            res.header('X-Nonce', nonce);
            res.status(status);
          }),
          map((env) => env),
        );
      })
    );
  }
}
