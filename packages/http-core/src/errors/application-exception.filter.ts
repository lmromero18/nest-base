import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { ApplicationException } from '@nest-base/core';

/** Opt-in filter; supports Express response and Fastify reply without importing either.
 * Neither message nor details are automatically exposed.
 */
@Catch(ApplicationException)
export class ApplicationExceptionFilter implements ExceptionFilter<ApplicationException> {
  catch(exception: ApplicationException, host: ArgumentsHost): void {
    const statuses = {
      validation: HttpStatus.BAD_REQUEST,
      'not-found': HttpStatus.NOT_FOUND,
      conflict: HttpStatus.CONFLICT,
      unsupported: HttpStatus.METHOD_NOT_ALLOWED,
    } as const;
    const statusCode =
      statuses[exception.category] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const reply = host.switchToHttp().getResponse<{
      status(code: number): { send(body: unknown): unknown };
    }>();
    reply.status(statusCode).send({
      statusCode,
      error: exception.category,
      code: exception.code,
    });
  }
}
