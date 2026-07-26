import { Body, Controller, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '../../common/decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { LoginService } from './login.service';

@Controller({
  path: 'seguridad/login',
})
export class LoginController {
  constructor(private readonly loginService: LoginService) {}

  @Public()
  @Post()
  async login(@Body() body: LoginDto, @Res() reply: FastifyReply) {
    const result = await this.loginService.login(body);

    return reply.status(result.statusCode).send(result.body);
  }
}
