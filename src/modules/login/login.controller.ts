import { Body, Controller, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { Public } from '../../common/decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { LoginService } from './login.service';

@ApiTags('Auth')
@Controller({
  path: 'seguridad/login',
})
export class LoginController {
  constructor(private readonly loginService: LoginService) {}

  @Public()
  // Límite estricto: el login es el blanco natural de fuerza bruta
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @ApiOperation({ summary: 'Autenticación contra el servicio externo' })
  async login(@Body() body: LoginDto, @Res() reply: FastifyReply) {
    const result = await this.loginService.login(body);

    return reply.status(result.statusCode).send(result.body);
  }
}
