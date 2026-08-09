import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { DeepPartial, Repository } from 'typeorm';
import { RequestContext } from '../../common/context/request-context';
import {
  BaseService,
  MutationOptions,
} from '../../common/services/base.service';
import { getEnv } from '../../common/utils/env';
import { DATABASE_CONNECTIONS } from '../../config/database/database.constants';
import {
  EMAIL_CLAIM_WINDOW_MS,
  EMAIL_RETRY_BASE_DELAY_MS,
  EMAIL_SEND_BATCH_SIZE,
  MAX_EMAIL_ATTEMPTS,
} from './notification.constants';
import { Notification } from './notification.entity';
import {
  NotificationType,
  SendEmailParams,
  SendResult,
} from './notification.types';

@Injectable()
export class NotificationService extends BaseService<Notification> {
  private readonly logger = new Logger(NotificationService.name);
  private transporter?: Transporter;

  protected override readonly filterable = [
    'id',
    'subject',
    'destination',
    'type',
    'isSent',
    'attempts',
    'clientId',
    'userId',
    'tsScheduledAt',
    'tsCreatedAt',
  ];
  protected override readonly sortable = [
    'id',
    'tsCreatedAt',
    'tsScheduledAt',
    'attempts',
  ];
  protected override readonly allowedRelations: string[] = [];
  // La trazabilidad usa clientId/userId propios, no las columnas idCreado/idActualizado
  protected override readonly auditColumns = null;

  constructor(
    @InjectRepository(Notification, DATABASE_CONNECTIONS.BASE)
    repository: Repository<Notification>,
  ) {
    super(repository);
  }

  override async create(
    data: DeepPartial<Notification>,
    options?: MutationOptions,
  ): Promise<Notification> {
    const raw = data as Record<string, unknown>;
    const scheduledAt = raw.tsScheduledAt
      ? new Date(raw.tsScheduledAt as string | number | Date)
      : null;

    return super.create(
      {
        ...data,
        tsScheduledAt: scheduledAt,
        // El estado del ciclo de envío siempre lo fija el servidor
        isSent: false,
        attempts: 0,
        lastError: null,
        tsNextRetryAt: null,
        clientId: RequestContext.clientId ?? null,
        userId:
          RequestContext.userId != null ? String(RequestContext.userId) : null,
      },
      options,
    );
  }

  /**
   * Procesa un lote de emails pendientes. Las filas se "reclaman" primero en
   * una transacción con FOR UPDATE SKIP LOCKED, de modo que ciclos solapados
   * u otras instancias del servicio nunca envían el mismo correo dos veces.
   */
  async processEmailBatch(): Promise<{ processed: number; sent: number }> {
    const claimed = await this.claimPendingEmails();
    if (claimed.length === 0) {
      return { processed: 0, sent: 0 };
    }

    let sent = 0;
    for (const notification of claimed) {
      const result = await this.sendEmail({
        to: notification.destination,
        subject: notification.subject,
        html: notification.content,
      });

      if (result.ok) {
        await this.markSent(notification.id);
        sent++;
      } else {
        await this.markFailed(notification, result.error ?? 'Unknown');
      }
    }

    return { processed: claimed.length, sent };
  }

  async sendEmail(params: SendEmailParams): Promise<SendResult> {
    const from = getEnv('NOTIFICATION_SMTP_FROM');
    if (!from) {
      return {
        ok: false,
        error: 'NOTIFICATION_SMTP_FROM no está configurado',
      };
    }

    try {
      await this.getTransporter().sendMail({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      });
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Fallo de envío desconocido';
      this.logger.error(
        `Error enviando email a ${params.to}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { ok: false, error: message };
    }
  }

  /**
   * Selecciona y reclama atómicamente el lote pendiente:
   *  - pendiente = no enviado, con intentos disponibles, programación vencida
   *    y sin ventana de reintento activa.
   *  - reclamar = attempts+1 y tsNextRetryAt adelantado EMAIL_CLAIM_WINDOW_MS,
   *    para que nadie más lo tome mientras se envía.
   */
  private async claimPendingEmails(
    now = new Date(),
    batchSize = EMAIL_SEND_BATCH_SIZE,
  ): Promise<Notification[]> {
    return this.repository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Notification);

      const rows = await repo
        .createQueryBuilder('n')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('n.type = :type', { type: NotificationType.EMAIL })
        .andWhere('n.isSent = :sent', { sent: false })
        .andWhere('n.attempts < :maxAttempts', {
          maxAttempts: MAX_EMAIL_ATTEMPTS,
        })
        .andWhere('(n.tsScheduledAt IS NULL OR n.tsScheduledAt <= :now)', {
          now,
        })
        .andWhere('(n.tsNextRetryAt IS NULL OR n.tsNextRetryAt <= :now)', {
          now,
        })
        .orderBy('n.id', 'ASC')
        .take(batchSize)
        .getMany();

      if (rows.length === 0) {
        return [];
      }

      await repo
        .createQueryBuilder()
        .update()
        .set({
          attempts: () => 'nu_attempts + 1',
          tsNextRetryAt: new Date(now.getTime() + EMAIL_CLAIM_WINDOW_MS),
        })
        .whereInIds(rows.map((row) => row.id))
        .execute();

      // Reflejar el intento reclamado para calcular el backoff si falla
      for (const row of rows) {
        row.attempts += 1;
      }

      return rows;
    });
  }

  private async markSent(id: number): Promise<void> {
    await this.repository.update(id, {
      isSent: true,
      lastError: null,
      tsNextRetryAt: null,
    });
  }

  private async markFailed(
    notification: Notification,
    error: string,
  ): Promise<void> {
    const attempts = notification.attempts;
    const exhausted = attempts >= MAX_EMAIL_ATTEMPTS;
    const delayMs = EMAIL_RETRY_BASE_DELAY_MS * 2 ** Math.min(attempts - 1, 6);

    await this.repository.update(notification.id, {
      lastError: error.substring(0, 2000),
      tsNextRetryAt: exhausted ? null : new Date(Date.now() + delayMs),
    });

    if (exhausted) {
      this.logger.warn(
        `La notificación ${notification.id} agotó los ${MAX_EMAIL_ATTEMPTS} intentos: ${error}`,
      );
    }
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const user = getEnv('NOTIFICATION_SMTP_USER');
      const pass = getEnv('NOTIFICATION_SMTP_PASS');
      this.transporter = createTransport({
        host: getEnv('NOTIFICATION_SMTP_HOST'),
        port: Number(getEnv('NOTIFICATION_SMTP_PORT', '587')),
        secure: getEnv('NOTIFICATION_SMTP_SECURE', 'false') === 'true',
        auth: user && pass ? { user, pass } : undefined,
      });
    }
    return this.transporter;
  }
}
