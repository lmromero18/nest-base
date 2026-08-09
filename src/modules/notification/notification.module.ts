import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DATABASE_CONNECTIONS } from '../../config/database/database.constants';
import { Notification } from './notification.entity';
import { NotificationController } from './notification.controller';
import { NotificationScheduler } from './notification.scheduler';
import { NotificationService } from './notification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification], DATABASE_CONNECTIONS.BASE),
  ],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationScheduler],
  exports: [NotificationService],
})
export class NotificationModule {}
