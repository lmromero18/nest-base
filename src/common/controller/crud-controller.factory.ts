import {
  Body,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Type,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { DeepPartial, ObjectLiteral } from 'typeorm';
import { RESPONSE_MESSAGES } from '../constants/response-messages';
import {
  SuccessResponse,
  successResponse,
} from '../responses/success.response';
import { BaseService, PaginatedResponse } from '../services/base.service';

export type CrudRoute =
  | 'find'
  | 'findOne'
  | 'create'
  | 'update'
  | 'softDelete'
  | 'hardDelete'
  | 'restore';

/** Rutas por defecto: sin borrado físico ni restore (se habilitan explícitamente). */
export const DEFAULT_CRUD_ROUTES: readonly CrudRoute[] = [
  'find',
  'findOne',
  'create',
  'update',
  'softDelete',
];

export interface CrudControllerOptions {
  /** DTO real de creación: aquí vive la validación del body (obligatorio si la ruta create está habilitada). */
  createDto?: Type<unknown>;
  /** DTO real de actualización (obligatorio si la ruta update está habilitada). */
  updateDto?: Type<unknown>;
  /** Rutas expuestas. Por defecto: find, findOne, create, update, softDelete. */
  routes?: readonly CrudRoute[];
  /** Etiqueta para agrupar los endpoints en Swagger. */
  swaggerTag?: string;
}

/**
 * Fábrica de controladores CRUD.
 *
 * Los genéricos de TypeScript se borran en compilación, por lo que un
 * `@Body() data: CreateDto` genérico llega al ValidationPipe como `Object`
 * y NO se valida. Esta fábrica recibe las clases DTO reales y las inyecta
 * con `expectedType`, garantizando validación + whitelist en create/update.
 *
 * Uso:
 *   @Controller('personas')
 *   export class PersonaController extends CrudControllerFactory<Persona>({
 *     createDto: CreatePersonaDto,
 *     updateDto: UpdatePersonaDto,
 *     routes: ['find', 'findOne', 'create', 'update', 'softDelete'],
 *     swaggerTag: 'Personas',
 *   }) {
 *     constructor(service: PersonaService) {
 *       super(service);
 *     }
 *   }
 *
 * El hijo puede añadir rutas propias y sobrescribir las heredadas.
 */
export function CrudControllerFactory<T extends ObjectLiteral>(
  options: CrudControllerOptions = {},
) {
  const routes = new Set<CrudRoute>(options.routes ?? DEFAULT_CRUD_ROUTES);

  if (routes.has('create') && !options.createDto) {
    throw new Error(
      'CrudControllerFactory: createDto es obligatorio con la ruta create habilitada',
    );
  }
  if (routes.has('update') && !options.updateDto) {
    throw new Error(
      'CrudControllerFactory: updateDto es obligatorio con la ruta update habilitada',
    );
  }

  const bodyPipe = (dto: Type<unknown>) =>
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      expectedType: dto,
    });

  const createPipes = options.createDto ? [bodyPipe(options.createDto)] : [];
  const updatePipes = options.updateDto ? [bodyPipe(options.updateDto)] : [];

  abstract class CrudController {
    protected readonly logger: Logger;

    constructor(protected readonly service: BaseService<T>) {
      this.logger = new Logger(this.constructor.name);
    }

    async find(
      @Query() query: Record<string, unknown>,
    ): Promise<PaginatedResponse<T>> {
      return this.service.find(query);
    }

    async findOne(
      @Param('id') id: string,
      @Query() query: Record<string, unknown>,
    ): Promise<T> {
      const withParam = typeof query.with === 'string' ? query.with : undefined;
      const entity = await this.service.findOne(id, { with: withParam });
      if (!entity) {
        throw new NotFoundException(RESPONSE_MESSAGES.GENERAL.NO_ENCONTRADO);
      }
      return entity;
    }

    async create(@Body(...createPipes) data: DeepPartial<T>): Promise<T> {
      return this.service.create(data);
    }

    async update(
      @Param('id') id: string,
      @Body(...updatePipes) data: DeepPartial<T>,
    ): Promise<T> {
      const updated = await this.service.updateByPk(id, data);
      if (!updated) {
        throw new NotFoundException(RESPONSE_MESSAGES.GENERAL.NO_ENCONTRADO);
      }
      return updated;
    }

    async softDelete(@Param('id') id: string): Promise<SuccessResponse> {
      const deleted = await this.service.softDeleteByPk(id);
      if (!deleted) {
        throw new NotFoundException(RESPONSE_MESSAGES.GENERAL.NO_ENCONTRADO);
      }
      return successResponse(RESPONSE_MESSAGES.GENERAL.ELIMINADO_EXITO);
    }

    async hardDelete(@Param('id') id: string): Promise<SuccessResponse> {
      const deleted = await this.service.removeByPk(id);
      if (!deleted) {
        throw new NotFoundException(RESPONSE_MESSAGES.GENERAL.NO_ENCONTRADO);
      }
      return successResponse(RESPONSE_MESSAGES.GENERAL.ELIMINADO_EXITO);
    }

    async restore(@Param('id') id: string): Promise<SuccessResponse> {
      const restored = await this.service.restoreByPk(id);
      if (!restored) {
        throw new NotFoundException(RESPONSE_MESSAGES.GENERAL.NO_ENCONTRADO);
      }
      return successResponse(RESPONSE_MESSAGES.GENERAL.RESTAURADO_EXITO);
    }
  }

  const idParam = ApiParam({ name: 'id', description: 'Clave primaria' });

  const routeDecorators: Record<CrudRoute, MethodDecorator[]> = {
    find: [
      Get(),
      ApiOperation({ summary: 'Listado paginado con filtros dinámicos' }),
      ApiQuery({ name: 'page', required: false, type: Number }),
      ApiQuery({ name: 'perPage', required: false, type: Number }),
      ApiQuery({
        name: 'orderBy',
        required: false,
        type: String,
        description: 'columna:ASC|DESC, separado por comas',
      }),
      ApiQuery({
        name: 'with',
        required: false,
        type: String,
        description: 'Relaciones a cargar (CSV)',
      }),
    ],
    findOne: [
      Get(':id'),
      ApiOperation({ summary: 'Detalle por clave primaria' }),
      idParam,
      ApiQuery({
        name: 'with',
        required: false,
        type: String,
        description: 'Relaciones a cargar (CSV)',
      }),
    ],
    create: [
      Post(),
      ApiOperation({ summary: 'Crear registro' }),
      ...(options.createDto ? [ApiBody({ type: options.createDto })] : []),
    ],
    update: [
      Patch(':id'),
      ApiOperation({ summary: 'Actualización parcial por clave primaria' }),
      idParam,
      ...(options.updateDto ? [ApiBody({ type: options.updateDto })] : []),
    ],
    softDelete: [
      Delete(':id'),
      ApiOperation({ summary: 'Borrado lógico' }),
      idParam,
    ],
    hardDelete: [
      Delete(':id/hard'),
      ApiOperation({ summary: 'Borrado físico definitivo' }),
      idParam,
    ],
    restore: [
      Patch(':id/restore'),
      ApiOperation({ summary: 'Restaurar registro borrado lógicamente' }),
      idParam,
    ],
  };

  // Solo las rutas habilitadas reciben decoradores HTTP: las demás quedan
  // como métodos sin ruta (invisibles para el router de Nest).
  for (const route of routes) {
    const descriptor = Object.getOwnPropertyDescriptor(
      CrudController.prototype,
      route,
    );
    if (!descriptor) continue;
    for (const decorator of routeDecorators[route]) {
      decorator(CrudController.prototype, route, descriptor);
    }
  }

  ApiBearerAuth()(CrudController);
  if (options.swaggerTag) {
    ApiTags(options.swaggerTag)(CrudController);
  }

  return CrudController;
}
