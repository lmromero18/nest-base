import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
} from '@nestjs/common';
import * as http from 'node:http';
import * as https from 'node:https';
import { getEnv } from '../utils/env';
import type { HttpResponseResult } from './http-response.type';

export interface HttpRequestOptions {
  token?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/**
 * Cliente HTTP saliente inyectable (JSON).
 * - TLS verificado por defecto; HTTP_CLIENT_REJECT_UNAUTHORIZED=false solo
 *   para entornos con certificados self-signed, nunca producción.
 * - Timeout configurable (HTTP_CLIENT_TIMEOUT_MS, default 10s).
 * - Errores de red → 502; timeout → 504.
 */
@Injectable()
export class HttpClientService {
  private readonly defaultTimeoutMs = Number(
    getEnv('HTTP_CLIENT_TIMEOUT_MS', '10000'),
  );

  private readonly rejectUnauthorized =
    getEnv('HTTP_CLIENT_REJECT_UNAUTHORIZED', 'true') !== 'false';

  getJson(url: URL, options?: HttpRequestOptions): Promise<HttpResponseResult> {
    return this.request(url, 'GET', null, options);
  }

  postJson(
    url: URL,
    body: Record<string, unknown>,
    options?: HttpRequestOptions,
  ): Promise<HttpResponseResult> {
    return this.request(url, 'POST', body, options);
  }

  putJson(
    url: URL,
    body: Record<string, unknown>,
    options?: HttpRequestOptions,
  ): Promise<HttpResponseResult> {
    return this.request(url, 'PUT', body, options);
  }

  request(
    url: URL,
    method: string,
    body: Record<string, unknown> | null,
    options: HttpRequestOptions = {},
  ): Promise<HttpResponseResult> {
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    const bodyStr =
      body && Object.keys(body).length > 0 ? JSON.stringify(body) : undefined;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...(options.headers ?? {}),
      };

      if (bodyStr) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
      }

      if (options.token) {
        headers['Authorization'] = `Bearer ${options.token}`;
      }

      const request = client.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method,
          headers,
          ...(isHttps ? { rejectUnauthorized: this.rejectUnauthorized } : {}),
        },
        (response) => {
          let rawData = '';

          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            rawData += chunk;
          });
          response.on('end', () => {
            resolve({
              statusCode: response.statusCode ?? 500,
              body: parseResponseBody(rawData),
            });
          });
        },
      );

      request.setTimeout(timeoutMs, () => {
        request.destroy(new TimeoutError(timeoutMs));
      });

      request.on('error', (error) => {
        if (error instanceof TimeoutError) {
          reject(
            new GatewayTimeoutException(
              `El servicio externo no respondió en ${timeoutMs}ms`,
            ),
          );
          return;
        }
        reject(
          new BadGatewayException(
            `Error comunicándose con el servicio externo: ${error.message}`,
          ),
        );
      });

      if (bodyStr) {
        request.write(bodyStr);
      }

      request.end();
    });
  }
}

class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

function parseResponseBody(rawData: string): unknown {
  if (!rawData) {
    return null;
  }

  try {
    return JSON.parse(rawData) as unknown;
  } catch {
    return { message: rawData };
  }
}
