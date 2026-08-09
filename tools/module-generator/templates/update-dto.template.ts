import type { NameModel } from '../generator';

export function renderUpdateDtoTemplate(name: NameModel): string {
  return `import { PartialType } from '@nestjs/swagger';
import { Create${name.className}Dto } from './create-${name.moduleName}.dto';

export class Update${name.className}Dto extends PartialType(Create${name.className}Dto) {}
`;
}
