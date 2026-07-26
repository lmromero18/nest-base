import {
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { RESPONSE_MESSAGES } from '../../common/constants/response-messages';
import { HttpClientService } from '../../common/http/http-client.service';
import type { HttpResponseResult } from '../../common/http/http-response.type';
import { getEnv } from '../../common/utils/env';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class LoginService {
  constructor(private readonly httpClient: HttpClientService) {}

  async login(payload: LoginDto): Promise<HttpResponseResult> {
    const { username, password } = payload;

    const baseUrl = getEnv('AUTH_API_URL');
    const clientId = getEnv('AUTH_CLIENT_ID');
    const clientSecret = getEnv('AUTH_CLIENT_SECRET');

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

    const response = await this.httpClient.postJson(url, requestBody);

    if (response.statusCode >= 400) {
      throw new HttpException(
        this.toHttpExceptionBody(response.body),
        response.statusCode,
      );
    }

    return response;
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
