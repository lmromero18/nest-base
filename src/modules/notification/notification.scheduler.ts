import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  CRON_RETRY_NOTIFICATIONS,
  CRON_SEND_EMAIL,
} from './notification.constants';
import { NotificationService } from './notification.service';

@Injectable()
export class NotificationScheduler {
  private readonly logger = new Logger(NotificationScheduler.name);

  constructor(private readonly service: NotificationService) {}

  @Cron(CRON_SEND_EMAIL)
  async handleSendEmail() {
    const res = await this.service.processEmailBatch();
    if (res.processed > 0) {
      this.logger.log(`Email cron processed=${res.processed} sent=${res.sent}`);
    }
  }

  @Cron(CRON_RETRY_NOTIFICATIONS)
  async handleRetry() {
    const res = await this.service.processRetries();
    if (res.processed > 0) {
      this.logger.log(`Retry cron processed=${res.processed} sent=${res.sent}`);
    }
  }
}
