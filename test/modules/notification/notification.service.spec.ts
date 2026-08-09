import { describe, expect, it } from 'bun:test';
import { RequestContext } from '../../../src/common/context/request-context';
import { BaseService } from '../../../src/common/services/base.service';
import { Notification } from '../../../src/modules/notification/notification.entity';
import { NotificationService } from '../../../src/modules/notification/notification.service';
import { NotificationType } from '../../../src/modules/notification/notification.types';

const createRepository = () =>
  ({
    create: (value: unknown) => value,
    save: (value: unknown) => Promise.resolve(value),
    manager: {},
  }) as never;

describe('NotificationService compatibility', () => {
  it('keeps context client and user getters in the notification create flow', async () => {
    const service = new NotificationService(createRepository());
    let received: Record<string, unknown> | undefined;
    const originalCreate = Object.getOwnPropertyDescriptor(
      BaseService.prototype,
      'create',
    )?.value as BaseService<Notification>['create'];
    BaseService.prototype.create = function (data) {
      received = data as Record<string, unknown>;
      return Promise.resolve(data);
    };

    try {
      await RequestContext.run(
        { principal: { subject: 42, clientId: 'client-a' } },
        async () => {
          await service.create({
            subject: 'Welcome',
            content: 'Body',
            destination: 'user@example.com',
            type: NotificationType.EMAIL,
          });
        },
      );
    } finally {
      BaseService.prototype.create = originalCreate;
    }

    expect(received).toMatchObject({
      clientId: 'client-a',
      userId: '42',
      isSent: false,
      attempts: 0,
      lastError: null,
      tsNextRetryAt: null,
    });
  });

  it('preserves safe unauthenticated and missing-SMTP behavior', async () => {
    const service = new NotificationService(createRepository());
    const originalCreate = Object.getOwnPropertyDescriptor(
      BaseService.prototype,
      'create',
    )?.value as BaseService<Notification>['create'];
    BaseService.prototype.create = function (data) {
      return Promise.resolve(data);
    };

    let result: unknown;
    try {
      result = await RequestContext.run({ requestId: 'public-request' }, () =>
        service.create({ subject: 'Public' }),
      );
    } finally {
      BaseService.prototype.create = originalCreate;
    }

    expect(result).toMatchObject({
      clientId: null,
      userId: null,
      isSent: false,
      attempts: 0,
    });
    expect(
      await service.sendEmail({ to: 'user@example.com', subject: 'Test' }),
    ).toEqual({
      ok: false,
      error: 'NOTIFICATION_SMTP_FROM no está configurado',
    });
  });

  it('returns an empty batch without invoking email transport when no rows are claimed', async () => {
    const service = new NotificationService(createRepository());
    (
      service as unknown as { claimPendingEmails: () => Promise<unknown[]> }
    ).claimPendingEmails = () => Promise.resolve([]);

    const result = await service.processEmailBatch();
    expect(result).toEqual({
      processed: 0,
      sent: 0,
    });
  });
});
