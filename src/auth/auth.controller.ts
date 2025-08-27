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

  private setAuthCookie(
    res: FastifyReply,
    jwt: string,
    expiresInSeconds: number,
  ) {
    const isProd = process.env.NODE_ENV === 'production';
    const cookieDomain = process.env.COOKIE_DOMAIN;
    console.log('COOKIE_DOMAIN:', cookieDomain);

    res.setCookie('access_token', jwt, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/',
      maxAge: expiresInSeconds,
    });
  }
}
