import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './notification.entity';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { NotificationScheduler } from './notification.scheduler';
import { getEnv } from 'src/common/utils/env';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification], getEnv('NOTIFICATION_DB_NAME')),
  ],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationScheduler],
  exports: [NotificationService],
})
export class NotificationModule {}
