import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { VersioningType } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthModule } from '../../../src/modules/health/health.module';

describe('HealthController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );

    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health responde 200 con el estado del servicio', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<Record<string, unknown>>();
    expect(body.status).toBe('OK');
    expect(body.version).toBeDefined();
    expect(body.timestamp).toBeDefined();
  });

  it('GET /api/v1/health/db responde 503 sin conexión de BD registrada', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health/db',
    });

    expect(response.statusCode).toBe(503);
  });
});
