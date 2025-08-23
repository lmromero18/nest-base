import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
} from '@nestjs/common';
import { Public } from './auth.decorator';
import { ILoginInput } from './auth.interfaces';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  signIn(@Body() user: ILoginInput) {
    return this.authService.signIn(user.username, user.contrasena);
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Request() request) {
    console.log({ request });
    return this.authService.refresh(request.user);
  }
}
