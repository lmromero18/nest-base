import { describe, expect, it } from 'bun:test';
import { HttpStatus } from '@nestjs/common';
import {
  SuccessResponse,
  successResponse,
} from '../../../src/common/responses/success.response';

describe('SuccessResponse', () => {
  it('construye el envelope con status y código OK por defecto', () => {
    expect(new SuccessResponse({ message: 'Creado', data: { id: 1 } })).toEqual(
      {
        status: 'success',
        message: 'Creado',
        statusCode: HttpStatus.OK,
        data: { id: 1 },
      },
    );
  });

  it('permite código, datos y meta personalizados', () => {
    const shortcut = successResponse('Eliminado', { id: 1 });
    expect(shortcut).toBeInstanceOf(SuccessResponse);
    expect(shortcut.data).toEqual({ id: 1 });

    const response = new SuccessResponse({
      message: 'Eliminado',
      statusCode: HttpStatus.NO_CONTENT,
      meta: { operation: 'delete' },
    });

    expect(response.statusCode).toBe(HttpStatus.NO_CONTENT);
    expect(response.meta).toEqual({ operation: 'delete' });
    expect(response.data).toBeUndefined();
  });
});
