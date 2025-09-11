import {
  Body,
  Controller,
  InternalServerErrorException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { NotificationService } from './notification.service';
import { CreateNotificationDto } from './notification.types';

@Controller('notification')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async create(
    @Body() body: CreateNotificationDto,
    @Req() req: Request,
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
