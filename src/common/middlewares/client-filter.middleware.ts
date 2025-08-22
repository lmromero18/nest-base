import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { decode } from 'jsonwebtoken';

@Injectable()
export class ClienteFilterMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction) {
    try {
      const auth = req.headers['authorization'];
      const token =
        auth && auth.startsWith('Bearer ')
          ? auth.substring('Bearer '.length)
          : undefined;

      if (!token) return next();

      // Decode (no verification here; AuthGuard handles verification)
      const payload: any = decode(token);
      if (!payload || typeof payload !== 'object') return next();

      const clienteId = payload?.aud ?? payload?.clienteId;
      if (!clienteId) return next();

      // Attach to request for downstream usage (guards/controllers)
      (req as any).user = { ...(req as any).user, ...payload, aud: clienteId };
      (req as any).clienteId = clienteId;

      // Auto-filter: inject clienteId into query for GET list endpoints
      if (req.method === 'GET') {
        // Only set if not explicitly provided by the client
        if (!req.query || typeof req.query !== 'object') {
          (req as any).query = {};
        }
        if (!('clienteId' in req.query)) {
          (req.query as any).clienteId = clienteId;
        }
      }

      // For write operations, default clienteId on body if it's a plain object
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        if (
          req.body &&
          typeof req.body === 'object' &&
          !Array.isArray(req.body)
        ) {
          if (!('clienteId' in req.body)) {
            (req.body as any).clienteId = clienteId;
          }
        }
      }

      return next();
    } catch (_e) {
      return next();
    }
  }
}
