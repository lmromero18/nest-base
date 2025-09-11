import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { getEnv } from '../common/utils/env';
import { EMAIL_SEND_BATCH_SIZE } from './notification.constants';
import { Notification } from './notification.entity';
import {
  CreateNotificationDto,
  NotificationCreateContext,
  NotificationType,
  SendEmailParams,
  SendResult,
} from './notification.types';

// Lazy import nodemailer only when needed to avoid hard dep during tests
let nodemailer: any;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  constructor(
    @InjectRepository(Notification, getEnv('NOTIFICATION_DB_NAME'))
    private readonly repo: Repository<Notification>,
  ) {}

  async create(
    dto: CreateNotificationDto,
    ctx: NotificationCreateContext = {},
  ): Promise<Notification> {
    const entity = this.repo.create({
      subject: dto.subject,
      content: dto.content,
      destination: dto.destination,
      type: dto.type,
      tsScheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt as any) : null,
      isSent: false,
      attempts: 0,
      clientId: ctx.clientId?.toString() ?? null,
      userId: ctx.userId?.toString() ?? null,
    });
    return await this.repo.save(entity);
  }

  // Batch fetch pending EMAIL notifications up to batchSize
  async getPendingEmailBatch(
    now = new Date(),
    batchSize = EMAIL_SEND_BATCH_SIZE,
  ) {
    return this.repo.find({
      where: [
        {
          type: NotificationType.EMAIL,
          isSent: false,
          tsScheduledAt: IsNull(),
        },
        {
          type: NotificationType.EMAIL,
          isSent: false,
          tsScheduledAt: LessThanOrEqual(now),
        },
      ],
      order: { id: 'ASC' },
      take: batchSize,
    });
  }

  async queryPendingEmailBatch(
    now = new Date(),
    batchSize = EMAIL_SEND_BATCH_SIZE,
  ) {
    return this.repo.find({
      where: [
        {
          type: NotificationType.EMAIL,
          isSent: false,
          tsScheduledAt: IsNull(),
        },
        {
          type: NotificationType.EMAIL,
          isSent: false,
          tsScheduledAt: LessThanOrEqual(now),
        },
      ],
      order: { id: 'ASC' },
      take: batchSize,
    });
  }

  async markSent(id: number) {
    await this.repo.update(id, { isSent: true, lastError: null });
  }

  async markFailed(id: number, error: string) {
    await this.repo.update({ id }, {
      isSent: false,
      attempts: () => 'attempts + 1',
      lastError: error?.substring(0, 2000) ?? 'Unknown',
    } as any);
  }

  private getTransport() {
    if (!nodemailer) {
      nodemailer = require('nodemailer');
    }
    const host = getEnv('NOTIFICATION_SMTP_HOST');
    const port = parseInt(getEnv('NOTIFICATION_SMTP_PORT', '587'));
    const secure = getEnv('NOTIFICATION_SMTP_SECURE', 'false') === 'true';
    const user = getEnv('NOTIFICATION_SMTP_USER');
    const pass = getEnv('NOTIFICATION_SMTP_PASS');
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
    return transporter;
  }

  async sendEmail(params: SendEmailParams): Promise<SendResult> {
    try {
      const transporter = this.getTransport();
      const from = getEnv('NOTIFICATION_SMTP_FROM', params.to);
      await transporter.sendMail({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
      });
      return { ok: true };
    } catch (e: any) {
      this.logger.error('Email send error', e?.stack || e);
      return { ok: false, error: e?.message || 'send failed' };
    }
  }

  async processEmailBatch(): Promise<{ processed: number; sent: number }> {
    const emails = await this.queryPendingEmailBatch();
    if (!emails.length) return { processed: 0, sent: 0 };
    let sent = 0;
    for (const email of emails) {
      const res = await this.sendEmail({
        to: email.destination,
        subject: email.subject,
        html: email.content,
      });
      if (res.ok) {
        await this.markSent(email.id);
        sent++;
      } else {
        await this.markFailed(email.id, res.error || 'Unknown');
      }
    }
    return { processed: emails.length, sent };
  }

  async getRetryableEmailBatch(
    now = new Date(),
    batchSize = EMAIL_SEND_BATCH_SIZE,
  ) {
    return this.repo.find({
      where: [
        {
          type: NotificationType.EMAIL,
          isSent: false,
          attempts: MoreThanOrEqual(1),
          tsScheduledAt: IsNull(),
        },
        {
          type: NotificationType.EMAIL,
          isSent: false,
          attempts: MoreThanOrEqual(1),
          tsScheduledAt: LessThanOrEqual(now),
        },
      ],
      order: { id: 'ASC' },
      take: batchSize,
    });
  }

  async processRetries(): Promise<{ processed: number; sent: number }> {
    const emails = await this.getRetryableEmailBatch();
    if (!emails.length) return { processed: 0, sent: 0 };
    let sent = 0;
    for (const email of emails) {
      const res = await this.sendEmail({
        to: email.destination,
        subject: email.subject,
        html: email.content,
      });
      if (res.ok) {
        await this.markSent(email.id);
        sent++;
      } else {
        await this.markFailed(email.id, res.error || 'Unknown');
      }
    }
    return { processed: emails.length, sent };
  }
}
