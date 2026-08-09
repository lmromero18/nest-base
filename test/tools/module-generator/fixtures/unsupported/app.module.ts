import { Module } from '@nestjs/common';

const importedModules: never[] = [];

@Module({
  imports: [...importedModules],
})
export class AppModule {}
