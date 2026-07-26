import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { getEnv } from '../utils/env';

interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error?: string;
  [key: string]: unknown;
}

interface PgDriverError {
  code?: string;
  detail?: string;
  column?: string;
  constraint?: string;
  message?: string;
}

/**
 * Filtro único de excepciones:
 * - HttpException → respeta status y body (incluye arrays de class-validator).
 * - Errores de TypeORM/Postgres → se mapean a códigos HTTP semánticos
 *   (unique 23505 → 409, FK 23503 → 409, not-null/formato → 400).
 * - Cualquier otro error → 500 con mensaje genérico en producción.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const body = this.buildBody(exception);
    const summary = Array.isArray(body.message)
      ? body.message.join('; ')
      : body.message;

    if (body.statusCode >= 500) {
      this.logger.error(
        `HTTP ${body.statusCode} ${request.method} ${request.url} — ${summary}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `HTTP ${body.statusCode} ${request.method} ${request.url} — ${summary}`,
      );
    }

    void response.status(body.statusCode).send(body);
  }

  private buildBody(exception: unknown): ErrorResponseBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const base =
        typeof res === 'string'
          ? { message: res }
          : (res as Record<string, unknown>);
      return { ...base, statusCode: status } as ErrorResponseBody;
    }

    if (exception instanceof QueryFailedError) {
      return this.mapQueryFailedError(exception as QueryFailedError<Error>);
    }

    if (exception instanceof EntityNotFoundError) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Recurso no encontrado',
        error: 'Not Found',
      };
    }

    const message =
      exception instanceof Error ? exception.message : 'Error desconocido';

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: isProduction() ? 'Error interno del servidor' : message,
      error: 'Internal Server Error',
    };
  }

  private mapQueryFailedError(exception: QueryFailedError): ErrorResponseBody {
    const driverError: PgDriverError =
      (exception as QueryFailedError & { driverError?: PgDriverError })
        .driverError ?? {};

    // El detail de Postgres incluye valores del registro; solo se expone fuera de producción
    const detail = isProduction() ? undefined : driverError.detail;

    switch (driverError.code) {
      case '23505':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'Ya existe un registro con esos datos',
          error: 'Conflict',
          ...(detail ? { detail } : {}),
        };
      case '23503':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'La operación entra en conflicto con registros relacionados',
          error: 'Conflict',
          ...(detail ? { detail } : {}),
        };
      case '23502':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: driverError.column
            ? `El campo ${driverError.column} es obligatorio`
            : 'Falta un campo obligatorio',
          error: 'Bad Request',
        };
      case '23514':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Los datos no cumplen las restricciones de la entidad',
          error: 'Bad Request',
          ...(detail ? { detail } : {}),
        };
      case '22P02':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Formato de valor inválido en la consulta',
          error: 'Bad Request',
        };
      case '22001':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Un valor excede la longitud máxima permitida',
          error: 'Bad Request',
        };
      case '22008':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Fecha u hora con formato inválido',
          error: 'Bad Request',
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: isProduction()
            ? 'Error interno del servidor'
            : (driverError.message ?? exception.message),
          error: 'Internal Server Error',
        };
    }
  }
}

function isProduction(): boolean {
  return getEnv('NODE_ENV') === 'production';
}
