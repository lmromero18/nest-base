import { CronExpression } from '@nestjs/schedule';

// Batch sizes and cron expressions
export const EMAIL_SEND_BATCH_SIZE = 20;

// Crons
export const CRON_SEND_EMAIL = CronExpression.EVERY_MINUTE;
export const CRON_RETRY_NOTIFICATIONS = CronExpression.EVERY_5_MINUTES;
