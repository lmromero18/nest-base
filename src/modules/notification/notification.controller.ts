import { Controller } from '@nestjs/common';
import { CrudControllerFactory } from '../../common/controller/crud-controller.factory';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { Notification } from './notification.entity';
import { NotificationService } from './notification.service';

@Controller('notification')
export class NotificationController extends CrudControllerFactory<Notification>(
  {
    createDto: CreateNotificationDto,
    updateDto: UpdateNotificationDto,
    routes: ['find', 'findOne', 'create', 'update', 'softDelete', 'restore'],
    swaggerTag: 'Notificaciones',
  },
) {
  constructor(service: NotificationService) {
    super(service);
  }
}
