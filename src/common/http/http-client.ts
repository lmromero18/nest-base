import { InternalServerErrorException } from '@nestjs/common';
import * as http from 'node:http';
import * as https from 'node:https';
import { getEnv } from '../utils/env';
import type { HttpResponseResult } from './http-response.type';

export class HttpClient {
  static buildUrl(
    path: string,
    queryParams?: Record<string, string>,
  ): URL {
    const baseUrl = getEnv('AUTH_API_URL');

    if (!baseUrl) {
      throw new InternalServerErrorException(
        'Falta configuracion de AUTH_API_URL',
      );
    }

    const url = new URL(path, baseUrl);

    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value);
      }
    }

    return url;
  }

  static stripClientId(obj: Record<string, unknown>): void {
    delete obj['client_id'];
  }

  static getJson(
    url: URL,
    token?: string,
  ): Promise<HttpResponseResult> {
    return HttpClient.request(url, token, 'GET', null);
  }

  static postJson(
    url: URL,
    token: string | undefined,
    body: Record<string, unknown>,
  ): Promise<HttpResponseResult> {
    return HttpClient.request(url, token, 'POST', body);
  }

  static putJson(
    url: URL,
    token: string | undefined,
    body: Record<string, unknown>,
  ): Promise<HttpResponseResult> {
    return HttpClient.request(url, token, 'PUT', body);
  }

  static requestAny(
    url: URL,
    token: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<HttpResponseResult> {
    return HttpClient.request(url, token, method as any, body);
  }

  private static request(
    url: URL,
    token: string | undefined,
    method: string,
    body: Record<string, unknown> | null,
  ): Promise<HttpResponseResult> {
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    const bodyStr = body && Object.keys(body).length > 0 ? JSON.stringify(body) : undefined;

    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };

      if (bodyStr) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
      }

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const request = client.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method,
          headers,
          rejectUnauthorized: false,
        },
        (response) => {
          let rawData = '';

          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            rawData += chunk;
          });
          response.on('end', () => {
            const parsedBody = HttpClient.parseResponseBody(rawData);

            resolve({
              statusCode: response.statusCode ?? 500,
              body: parsedBody,
            });
          });
        },
      );

      request.on('error', (error) => {
        reject(new InternalServerErrorException(error.message));
      });

      if (bodyStr) {
        request.write(bodyStr);
      }

      request.end();
    });
  }

  private static parseResponseBody(rawData: string): unknown {
    if (!rawData) {
      return null;
    }

    try {
      return JSON.parse(rawData) as unknown;
    } catch {
      return { message: rawData };
    }
  }
}
