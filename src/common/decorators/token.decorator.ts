import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { extractBearerToken } from '../utils/token.util';

export const Token = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    return extractBearerToken(request.headers.authorization);
  },
);
