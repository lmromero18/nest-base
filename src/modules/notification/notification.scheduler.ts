import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CRON_SEND_EMAIL } from './notification.constants';
import { NotificationService } from './notification.service';

@Injectable()
export class NotificationScheduler {
  private readonly logger = new Logger(NotificationScheduler.name);
  private running = false;

  constructor(private readonly service: NotificationService) {}

  /**
   * Un único cron cubre envíos nuevos y reintentos: el claim con
   * tsNextRetryAt + backoff decide qué está listo para procesarse.
   */
  @Cron(CRON_SEND_EMAIL)
  async handleSendEmail(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.service.processEmailBatch();
      if (result.processed > 0) {
        this.logger.log(
          `Email cron processed=${result.processed} sent=${result.sent}`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Fallo procesando el lote de emails',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
