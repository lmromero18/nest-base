import { describe, expect, it } from 'bun:test';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationType } from '../../../src/modules/notification/notification.types';
import { CreateNotificationDto } from '../../../src/modules/notification/dto/create-notification.dto';
import { UpdateNotificationDto } from '../../../src/modules/notification/dto/update-notification.dto';
import { Notification } from '../../../src/modules/notification/notification.entity';
import { CrudControllerFactory } from '../../../src/common/controller/crud-controller.factory';
import { SuccessResponse } from '../../../src/common/responses/success.response';
import {
  BaseService,
  PaginatedResponse,
} from '../../../src/common/services/base.service';

const Controller = CrudControllerFactory<Notification>({
  createDto: CreateNotificationDto,
  updateDto: UpdateNotificationDto,
});

class TestController extends Controller {}

const createService = (overrides: Record<string, unknown> = {}) =>
  ({
    find: (query: Record<string, unknown>) =>
      Promise.resolve({
        data: [{ id: 1, ...query }],
        meta: { page: 1 },
      }),
    findOne: () => Promise.resolve({ id: 1, subject: 'Welcome' }),
    create: (data: unknown) => Promise.resolve(data),
    updateByPk: (_id: string, data: unknown) => Promise.resolve(data),
    softDeleteByPk: () => Promise.resolve({ id: 1 }),
    ...overrides,
  }) as unknown as BaseService<Notification>;

describe('CrudControllerFactory', () => {
  it('delegates find, create, and update to the injected service', async () => {
    const calls: unknown[][] = [];
    const service = createService({
      find: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({
          data: [{ id: 7 } as Notification],
          meta: { page: 2 },
        });
      },
      create: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({ id: 8 } as Notification);
      },
      updateByPk: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({ id: 9 } as Notification);
      },
    });
    const controller = new TestController(service);

    const found = await controller.find({ page: '2' });
    expect(found).toEqual({
      data: [{ id: 7 } as Notification],
      meta: { page: 2 },
    } as unknown as PaginatedResponse<Notification>);
    const created = await controller.create({ subject: 'Hello' });
    expect(created).toEqual({
      id: 8,
    } as Notification);
    const updated = await controller.update('9', { subject: 'Updated' });
    expect(updated).toEqual({ id: 9 } as Notification);

    expect(calls).toEqual([
      [{ page: '2' }],
      [{ subject: 'Hello' }],
      ['9', { subject: 'Updated' }],
    ]);
  });

  it('applies the DTO validation pipe to create and update bodies', async () => {
    const metadata = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      Controller,
      'create',
    ) as Record<string, { pipes: unknown[] }>;
    const bodyArgument = Object.values(metadata).find(
      (argument) => argument.pipes.length,
    );
    const pipe = bodyArgument?.pipes[0] as {
      transform: (
        value: unknown,
        metadata: { type: string },
      ) => Promise<unknown>;
    };

    let validationError: unknown;
    try {
      await pipe.transform(
        {
          subject: '',
          content: 'Body',
          destination: 'user@example.com',
          type: NotificationType.EMAIL,
          unexpected: true,
        },
        { type: 'body' },
      );
    } catch (error) {
      validationError = error;
    }
    expect(validationError).toBeInstanceOf(BadRequestException);

    const valid = await pipe.transform(
      {
        subject: 'Welcome',
        content: 'Body',
        destination: 'user@example.com',
        type: NotificationType.EMAIL,
      },
      { type: 'body' },
    );
    expect(valid).toBeInstanceOf(CreateNotificationDto);
    expect(valid).toEqual({
      subject: 'Welcome',
      content: 'Body',
      destination: 'user@example.com',
      type: NotificationType.EMAIL,
    });

    const updateMetadata = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      Controller,
      'update',
    ) as Record<string, { pipes: unknown[] }>;
    const updatePipe = Object.values(updateMetadata).find(
      (argument) => argument.pipes.length,
    )?.pipes[0] as typeof pipe;
    const update = await updatePipe.transform(
      { subject: 'Updated' },
      { type: 'body' },
    );
    expect(update).toBeInstanceOf(UpdateNotificationDto);
    expect(update).toEqual({ subject: 'Updated' });
  });

  it('raises the adapter not-found response for missing entities', async () => {
    const controller = new TestController(
      createService({
        findOne: () => Promise.resolve(null),
        updateByPk: () => Promise.resolve(null),
      }),
    );

    let findError: unknown;
    try {
      await controller.findOne('404', {});
    } catch (error) {
      findError = error;
    }
    expect(findError).toBeInstanceOf(NotFoundException);

    let updateError: unknown;
    try {
      await controller.update('404', { subject: 'Missing' });
    } catch (error) {
      updateError = error;
    }
    expect(updateError).toBeInstanceOf(NotFoundException);
  });

  it('returns the standard SuccessResponse for a successful soft delete', async () => {
    const controller = new TestController(createService());

    const response = await controller.softDelete('1');

    expect(response).toBeInstanceOf(SuccessResponse);
    expect(response).toEqual({
      status: 'success',
      message: 'Eliminado correctamente',
      statusCode: 200,
    });
  });
});
