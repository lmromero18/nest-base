import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  Res,
} from '@nestjs/common';
import { Public } from './auth.decorator';
import { ILoginInput } from './auth.interfaces';
import { AuthService } from './auth.service';
import { FastifyReply } from 'fastify';
import { ACCESS_TOKEN_NAME } from './constants';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async signIn(
    @Body() user: ILoginInput,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const token = await this.authService.signIn(user.username, user.contrasena);
    this.setAuthCookie(res, token.access_token, token.expires_in);
    return token;
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Request() request,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const token = await this.authService.refresh(request.user);
    this.setAuthCookie(res, token.access_token, token.expires_in);
    return token;
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(
    @Request() request,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    await this.authService.logout(request.user);
    this.clearAuthCookie(res);
    return null;
  }

  private setAuthCookie(
    res: FastifyReply,
    jwt: string,
    expiresInSeconds: number,
  ) {
    const isProd = process.env.NODE_ENV === 'production';
    const cookieDomain = process.env.COOKIE_DOMAIN;

    res.setCookie(ACCESS_TOKEN_NAME, jwt, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/',
      maxAge: expiresInSeconds,
      domain: cookieDomain || undefined,
    });
  }

  private clearAuthCookie(res: FastifyReply) {
    const isProd = process.env.NODE_ENV === 'production';
    const cookieDomain = process.env.COOKIE_DOMAIN;
    res.clearCookie(ACCESS_TOKEN_NAME, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/',
      domain: cookieDomain || undefined,
    });
  }
}
