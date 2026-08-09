import type { NameModel } from '../generator';

export function renderServiceTemplate(name: NameModel): string {
  return `import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseService } from '../../common/services/base.service';
import { DATABASE_CONNECTIONS } from '../../config/database/database.constants';
import { ${name.entityName} } from './${name.moduleName}.entity';

@Injectable()
export class ${name.className}Service extends BaseService<${name.entityName}> {
  protected override readonly filterable = ['id', 'name', 'tsCreatedAt'];
  protected override readonly sortable = ['id', 'name', 'tsCreatedAt'];
  protected override readonly allowedRelations: string[] = [];
  protected override readonly auditColumns = null;

  constructor(
    @InjectRepository(${name.entityName}, DATABASE_CONNECTIONS.BASE)
    repository: Repository<${name.entityName}>,
  ) {
    super(repository);
  }
}
`;
}
