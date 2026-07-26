import {
  HttpException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';

/**
 * Rethrows HttpException as-is; otherwise wraps error message into UnprocessableEntityException.
 * Also logs the message using the provided logger (or a default one).
 */
export function handleErrorWrapper(
  e: any,
  defaultMessage: string,
  logger?: Logger,
): never {
  const msg = e?.message ?? String(e);
  try {
    (logger ?? new Logger('ErrorUtil')).error(msg);
  } catch {}
  if (e instanceof HttpException) {
    throw e;
  }
  throw new UnprocessableEntityException(msg || defaultMessage);
}
