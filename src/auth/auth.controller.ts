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
import { IUser } from './auth.interfaces';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  signIn(@Body() user: IUser) {
    return this.authService.signIn(user.username, user.password);
  }

  @Get('profile')
  getProfile(@Request() req) {
    return req.user;
  }
}
