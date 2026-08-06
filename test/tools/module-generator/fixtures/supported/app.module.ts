import { Module } from '@nestjs/common';
import { ExistingModule } from './existing.module';

@Module({
  imports: [ExistingModule],
})
export class AppModule {}
