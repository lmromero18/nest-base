import type { NameModel } from '../generator';

export function renderControllerTemplate(name: NameModel): string {
  return `import { Controller } from '@nestjs/common';
import { CrudControllerFactory } from '../../common/controller/crud-controller.factory';
import { Create${name.className}Dto } from './dto/create-${name.moduleName}.dto';
import { Update${name.className}Dto } from './dto/update-${name.moduleName}.dto';
import { ${name.entityName} } from './${name.moduleName}.entity';
import { ${name.className}Service } from './${name.moduleName}.service';

@Controller('${name.route}')
export class ${name.className}Controller extends CrudControllerFactory<${name.entityName}>({
  createDto: Create${name.className}Dto,
  updateDto: Update${name.className}Dto,
  routes: ['find', 'findOne', 'create', 'update', 'softDelete'],
  swaggerTag: '${name.className}',
}) {
  constructor(service: ${name.className}Service) {
    super(service);
  }
}
`;
}
