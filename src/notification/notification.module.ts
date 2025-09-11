import { Module } from '@nestjs/common';
import { DatabaseModule } from '../modules/database.module';
import { Notification } from './notification.entity';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { NotificationScheduler } from './notification.scheduler';
import { getEnv } from 'src/common/utils/env';

@Module({
  imports: [
    DatabaseModule.forEntities(getEnv('NOTIFICATION_DB_NAME'), [Notification]),
  ],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationScheduler],
  exports: [NotificationService],
})
export class NotificationModule {}
