import type { NameModel } from '../generator';

export function renderModuleTemplate(name: NameModel): string {
  return `import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DATABASE_CONNECTIONS } from '../../config/database/database.constants';
import { ${name.entityName} } from './${name.moduleName}.entity';
import { ${name.className}Controller } from './${name.moduleName}.controller';
import { ${name.className}Service } from './${name.moduleName}.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([${name.entityName}], DATABASE_CONNECTIONS.BASE),
  ],
  controllers: [${name.className}Controller],
  providers: [${name.className}Service],
  exports: [${name.className}Service],
})
export class ${name.className}Module {}
`;
}
