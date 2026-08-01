# @nest-base/http-core

Core NestJS HTTP adapter for the CRUD foundation in `@nest-base/core`.
The adapter family is intentionally extensible: future packages may provide
runtime-specific implementations such as `@nest-base/http-fastify` and
`@nest-base/http-express` without changing this public CRUD contract.

## Install

```bash
npm install @nest-base/http-core @nest-base/core @nestjs/common @nestjs/swagger typeorm
```

The package keeps NestJS, Swagger, TypeORM, and `@nest-base/core` external as
peer dependencies. The application must install compatible versions itself.

## Usage

```ts
import { Controller } from '@nestjs/common';
import { CrudControllerFactory } from '@nest-base/http-core';
import type { Persona } from './persona.entity';
import { CreatePersonaDto } from './dto/create-persona.dto';
import { UpdatePersonaDto } from './dto/update-persona.dto';
import { PersonaService } from './persona.service';

@Controller('personas')
export class PersonaController extends CrudControllerFactory<Persona>({
  createDto: CreatePersonaDto,
  updateDto: UpdatePersonaDto,
  swaggerTag: 'Personas',
}) {
  constructor(service: PersonaService) {
    super(service);
  }
}
```

The factory preserves the existing route defaults and validation behavior:
`find`, `findOne`, `create`, `update`, and `softDelete` are enabled by default;
`hardDelete` and `restore` require explicit route configuration.
