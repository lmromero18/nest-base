import { CronExpression } from '@nestjs/schedule';

export const EMAIL_SEND_BATCH_SIZE = 20;

/** Tope de intentos: superado, la notificación queda como fallida definitiva. */
export const MAX_EMAIL_ATTEMPTS = 5;

/**
 * Ventana de reclamo: al tomar un lote se adelanta tsNextRetryAt para que
 * ningún otro ciclo (u otra instancia) procese las mismas filas en paralelo.
 */
export const EMAIL_CLAIM_WINDOW_MS = 5 * 60_000;

/** Base del backoff exponencial entre reintentos (1min, 2min, 4min, ...). */
export const EMAIL_RETRY_BASE_DELAY_MS = 60_000;

export const CRON_SEND_EMAIL = CronExpression.EVERY_MINUTE;
