import {
  Body,
  Controller,
  InternalServerErrorException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import type { CreateNotificationDto } from './dto/create-notification.dto';
import type { FastifyRequest } from 'fastify';

@Controller('notification')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async create(
    @Body() body: CreateNotificationDto,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    try {
      const user: any = (req as any).user || {};
      const clienteId: any = (req as any).clienteId ?? user?.aud;
      await this.service.create(body, {
        clientId: clienteId,
        userId: user?.sub,
      });
      return;
    } catch (e) {
      throw new InternalServerErrorException('Failed to create notification');
    }
  }
}
