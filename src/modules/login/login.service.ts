import {
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import * as http from 'node:http';
import * as https from 'node:https';
import { RESPONSE_MESSAGES } from '../../common/constants/response-messages';
import { getEnv } from '../../common/utils/env';
import { LoginDto } from './dto/login.dto';

type HttpResponseResult = {
  statusCode: number;
  body: unknown;
};

@Injectable()
export class LoginService {
  async login(payload: LoginDto): Promise<HttpResponseResult> {
    const { username, password } = payload;

    const baseUrl = getEnv('AUTH_API_URL');
    const clientId = getEnv('CENSO_CLIENT_ID');
    const clientSecret = getEnv('CENSO_CLIENT_SECRET');

    if (!baseUrl || !clientId || !clientSecret) {
      throw new InternalServerErrorException(
        RESPONSE_MESSAGES.AUTH.LOGIN.CONFIG_MISSING,
      );
    }

    const url = new URL('/api/v3/auth/login', baseUrl);
    const requestBody = {
      username,
      password,
      grant_type: 'password',
      secret: clientSecret,
      scope: '*',
      client_id: clientId,
    };

    const response = await this.postJson(url, requestBody);

    if (response.statusCode >= 400) {
      throw new HttpException(
        this.toHttpExceptionBody(response.body),
        response.statusCode,
      );
    }

    return response;
  }

  private postJson(
    url: URL,
    payload: Record<string, unknown>,
  ): Promise<HttpResponseResult> {
    const body = JSON.stringify(payload);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const request = client.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (response) => {
          let rawData = '';

          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            rawData += chunk;
          });
          response.on('end', () => {
            const parsedBody = this.parseResponseBody(rawData);

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

      request.write(body);
      request.end();
    });
  }

  private parseResponseBody(rawData: string): unknown {
    if (!rawData) {
      return null;
    }

    try {
      return JSON.parse(rawData) as unknown;
    } catch {
      return { message: rawData };
    }
  }

  private toHttpExceptionBody(body: unknown): string | Record<string, unknown> {
    if (typeof body === 'string') {
      return body;
    }

    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }

    return {
      message: RESPONSE_MESSAGES.AUTH.LOGIN.PROCESS_ERROR,
      details: body,
    };
  }
}
