import type { NameModel } from '../generator';

export function renderCreateDtoTemplate(name: NameModel): string {
  return `import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class Create${name.className}Dto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}
`;
}
