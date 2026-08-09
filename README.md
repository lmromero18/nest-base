# NEST-BASE

Plantilla base para construir APIs REST con NestJS. Su eje es una **librería CRUD genérica** (`BaseService` + `CrudControllerFactory`) que da a cada módulo listados con filtros dinámicos, paginación, validación real y auditoría sin repetir código.

## Repositorio

```text
https://github.com/lmromero18/nest-base
```

## Stack

- Bun (runtime, package manager y test runner)
- NestJS 11 (Fastify)
- TypeScript (strict)
- TypeORM + PostgreSQL
- Swagger en `/docs` (desactivado en producción por defecto)

## Requisitos

- [Bun](https://bun.sh) >= 1.3

## Configuración

```bash
cp .env.example .env
bun install
bun run migration:run   # crea/actualiza el esquema
bun run start:dev
```

Variables clave: `JWT_PUBLIC_KEY` (o `JWT_SECRET`) es **obligatoria** para que las rutas protegidas verifiquen la firma de los tokens — sin ella la app responde 503 en rutas privadas (y en producción no arranca). `CORS_ORIGINS` restringe orígenes en producción.

### Pool de conexiones a PostgreSQL

`DB_BASE_POOL_MAX` define el máximo de conexiones simultáneas que puede abrir **cada instancia** de la API contra PostgreSQL:

```env
DB_BASE_POOL_MAX=10
```

Una instancia es cada proceso, contenedor, pod o worker independiente de NestJS. Por ejemplo, 3 instancias con un pool de 10 pueden abrir hasta 30 conexiones en total.

El valor debe considerar todas las instancias desplegadas:

```text
pool por instancia <= (max_connections de PostgreSQL - conexiones reservadas) / cantidad de instancias
```

Como punto de partida, `5–10` conexiones suele ser suficiente para proyectos pequeños. No conviene aumentar el valor sin medir: un pool demasiado grande puede agotar las conexiones disponibles de PostgreSQL y empeorar el rendimiento.

## Scripts

```bash
bun run start:dev          # desarrollo con watch
bun run start:prod         # producción (TypeScript directo con Bun)
bun run build              # compila a dist con tsc (nest build)
bun run typecheck          # tsc --noEmit
bun run lint               # eslint (solo lectura)
bun run lint:fix           # eslint --fix
bun run format:check       # verifica el formato sin modificar archivos
bun run lint:check         # alias de lint para CI
bun test                   # unit + e2e (test/ con subcarpetas por módulo)
bun run migration:run      # aplica migraciones
bun run migration:generate src/config/database/migrations/NombreCambio
```

### CI y verificaciones de calidad

GitHub Actions ejecuta en cada `push` y `pull_request` la instalación
reproducible con Bun 1.3.14, el formato, lint, typecheck, tests y build.
Localmente, `lint` y `format:check` son de solo lectura; usa `lint:fix` o
`format` cuando quieras aplicar cambios.

---

## La librería base

### Framework boundaries

The reusable surface is intentionally a TypeORM-aware persistence core
(`BaseService` and query contracts), surrounded by transport/infrastructure
adapters such as `CrudControllerFactory`, and application-owned modules and
policy. See the [framework boundary contract](docs/framework-boundaries.md)
for dependency rules, promotion criteria, preserved behavior, and non-goals.
This phase changes documentation and static rules only; it does not move or
change runtime code.

### Crear un CRUD estándar

Para agregar un recurso CRUD, la estructura mínima recomendada es:

```text
src/modules/persona/
  persona.module.ts
  persona.controller.ts
  persona.service.ts
  persona.entity.ts
  dto/
    create-persona.dto.ts
    update-persona.dto.ts
```

Además de estos archivos, el módulo debe tener su migración y quedar registrado
en el módulo raíz. La entidad también debe estar disponible para el
`data-source.ts` utilizado por TypeORM CLI.

#### 1. Service con `BaseService`

**Service** — extiende `BaseService` y declara qué expone:

```ts
@Injectable()
export class PersonaService extends BaseService<Persona> {
  protected override readonly filterable = [
    'nombre',
    'estado',
    'ciudad.nombre',
  ];
  protected override readonly sortable = ['id', 'nombre'];
  protected override readonly allowedRelations = ['ciudad'];
  protected override readonly maxPerPage = 100;

  constructor(
    @InjectRepository(Persona, DATABASE_CONNECTIONS.BASE)
    repository: Repository<Persona>,
  ) {
    super(repository);
  }
}
```

Sin configurar, se exponen todas las columnas visibles; las columnas `select: false` (hashes, secretos) **nunca** son filtrables ni ordenables.

**Controller** — la factory recibe los DTOs reales (ahí vive la validación) y las rutas a exponer:

```ts
import { CrudControllerFactory } from '@nest-base/http-core';

@Controller('personas')
export class PersonaController extends CrudControllerFactory<Persona>({
  createDto: CreatePersonaDto,
  updateDto: UpdatePersonaDto,
  routes: ['find', 'findOne', 'create', 'update', 'softDelete'],
  swaggerTag: 'Personas',
}) {
  constructor(service: PersonaService) {
    super(service);
  }
}
```

#### Agregar una ruta personalizada

El controller puede conservar las rutas CRUD estándar y agregar operaciones
propias. La lógica de negocio debe delegarse al service:

```ts
import { Controller, Param, Post } from '@nestjs/common';

@Controller('personas')
export class PersonaController extends CrudControllerFactory<Persona>({
  createDto: CreatePersonaDto,
  updateDto: UpdatePersonaDto,
  routes: ['find', 'findOne', 'create', 'update', 'softDelete'],
  swaggerTag: 'Personas',
}) {
  constructor(private readonly personaService: PersonaService) {
    super(personaService);
  }

  @Post(':id/activar')
  async activate(@Param('id') id: string): Promise<Persona> {
    return this.personaService.activate(id);
  }
}
```

Esto agrega `POST /api/v1/personas/:id/activar` sin reemplazar las rutas
generadas por la factory.

#### Sobrescribir `create` o `update`

Si una operación CRUD necesita reglas adicionales, se puede sobrescribir el
método heredado. Se recomienda declarar nuevamente el decorador HTTP y usar el
DTO concreto para conservar la validación del body:

```ts
import {
  Body,
  Controller,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

@Controller('personas')
export class PersonaController extends CrudControllerFactory<Persona>({
  createDto: CreatePersonaDto,
  updateDto: UpdatePersonaDto,
  routes: ['find', 'findOne', 'create', 'update', 'softDelete'],
  swaggerTag: 'Personas',
}) {
  constructor(private readonly personaService: PersonaService) {
    super(personaService);
  }

  @Post()
  override async create(@Body() data: CreatePersonaDto): Promise<Persona> {
    return this.personaService.createFromRequest(data);
  }

  @Patch(':id')
  override async update(
    @Param('id') id: string,
    @Body() data: UpdatePersonaDto,
  ): Promise<Persona> {
    const updated = await this.personaService.updateFromRequest(id, data);
    if (!updated) {
      throw new NotFoundException('Persona no encontrada');
    }
    return updated;
  }
}
```

La lógica específica queda en el service, no en el controller:

```ts
@Injectable()
export class PersonaService extends BaseService<Persona> {
  // Conserva aquí el constructor y las allowlists del ejemplo anterior.

  async createFromRequest(dto: CreatePersonaDto): Promise<Persona> {
    const payload = {
      ...dto,
      nombre: dto.nombre.trim(),
    };

    return super.create(payload);
  }

  async updateFromRequest(
    id: string,
    dto: UpdatePersonaDto,
  ): Promise<Persona | null> {
    return super.updateByPk(id, dto);
  }
}
```

Para una personalización simple también se puede llamar a `super.create(data)`
desde el controller. Para actualizar desde el service se utiliza
`super.updateByPk(id, data)`. Las reglas de negocio y las transacciones deben
permanecer en el service.

#### Ejecutar transacciones

Las operaciones que deben confirmarse juntas se agrupan en el service. El
service debe inyectar el `DataSource` de la conexión correspondiente:

```ts
constructor(
  @InjectRepository(Persona, DATABASE_CONNECTIONS.BASE)
  repository: Repository<Persona>,
  @InjectDataSource(DATABASE_CONNECTIONS.BASE)
  private readonly dataSource: DataSource,
) {
  super(repository);
}
```

Todas las operaciones que participan deben recibir el mismo `manager`:

```ts
async createWithAddress(
  personaDto: CreatePersonaDto,
  addressDto: CreateAddressDto,
): Promise<Persona> {
  return this.dataSource.transaction(async (manager) => {
    const persona = await this.create(personaDto, { manager });

    await this.addressService.create(addressDto, { manager });

    return persona;
  });
}
```

El controller solamente invoca `createWithAddress()`. Si una operación falla,
TypeORM revierte todas las escrituras de la transacción.

#### Ejemplos HTTP

El prefijo global de la aplicación es `/api` y la versión por defecto es `v1`.
Las rutas protegidas requieren un token Bearer.

Listado con filtros y paginación:

```bash
curl "http://localhost:3000/api/v1/personas?estado=ACTIVO&nombre_like=ana&page=1&perPage=20&orderBy=nombre:ASC" \
  -H "Authorization: Bearer <token>"
```

Respuesta de listado:

```json
{
  "data": [{ "id": 1, "nombre": "Ana", "estado": "ACTIVO" }],
  "total": 1,
  "currentPage": 1,
  "lastPage": 1,
  "perPage": 20,
  "from": 1,
  "to": 1
}
```

Crear:

```bash
curl -X POST "http://localhost:3000/api/v1/personas" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Ana","estado":"ACTIVO"}'
```

Actualizar y eliminar:

```bash
curl -X PATCH "http://localhost:3000/api/v1/personas/1" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"estado":"INACTIVO"}'

curl -X DELETE "http://localhost:3000/api/v1/personas/1" \
  -H "Authorization: Bearer <token>"
```

Las rutas `find`, `findOne`, `create` y `update` devuelven actualmente sus
datos directamente. Las acciones `softDelete`, `hardDelete` y `restore`
devuelven el envelope `SuccessResponse`. Los errores pasan por
`GlobalExceptionFilter`, que conserva el status HTTP y devuelve un body con
`statusCode`, `message` y `error`.

Ejemplo de error cuando el recurso no existe:

```http
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "statusCode": 404,
  "message": "Recurso no encontrado",
  "error": "Not Found"
}
```

Rutas disponibles: `find` (GET /), `findOne` (GET /:id), `create` (POST), `update` (PATCH /:id), `softDelete` (DELETE /:id), `hardDelete` (DELETE /:id/hard), `restore` (PATCH /:id/restore). Por defecto no se exponen `hardDelete` ni `restore`. `softDelete`/`restore` requieren `@DeleteDateColumn` en la entidad (si falta, responden 405).

> Los genéricos de TypeScript se borran al compilar: un `@Body() data: CreateDto` genérico llega al pipe como `Object` y no se valida. Por eso la factory inyecta los DTOs con `expectedType`. Regla derivada: los DTOs de `@Body` se importan **como valor**, nunca con `import type`.

### Contrato de query-string en listados

```text
GET /api/v1/personas?estado=ACTIVO&nombre_like=ana&page=2&perPage=50
```

| Sintaxis                      | Significado                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `campo=v`                     | igualdad (repetido → `IN`)                                                                                |
| `campo_like=v`                | `ILIKE %v%` (castea no-texto)                                                                             |
| `campo_gte=v` / `campo_lte=v` | `>=` / `<=`                                                                                               |
| `campo_between=a,b`           | rango (malformado → 400)                                                                                  |
| `campo_null=true\|false`      | `IS NULL` / `IS NOT NULL`                                                                                 |
| `campo_not=a,b`               | `NOT IN`                                                                                                  |
| `relacion.campo=v`            | filtro sobre relación (ruta completa validada)                                                            |
| `with=rel,rel.sub`            | carga relaciones permitidas                                                                               |
| `orderBy=campo:DESC,otro`     | ordenamiento (allowlist)                                                                                  |
| `or=[{"a":1},{"b":2}]`        | bloques OR (solo igualdad) combinados con el AND base                                                     |
| `page` / `perPage`            | paginación; `perPage` tiene tope (`maxPerPage`); `perPage=0` solo si el service define `allowUnpaginated` |

Todo campo/relación fuera de la allowlist se ignora en silencio. La respuesta de listado es:

```json
{
  "data": [],
  "total": 0,
  "currentPage": 1,
  "lastPage": 1,
  "perPage": 20,
  "from": null,
  "to": null
}
```

### Escrituras seguras

- `create`/`updateByPk` descartan del payload las columnas generadas (PK), timestamps automáticos, soft-delete y versión: un `POST {"id": 7}` no puede sobrescribir la fila 7.
- Si la entidad tiene columnas `idCreado`/`idActualizado`, `BaseService` las estampa automáticamente con el usuario del token (vía `RequestContext`, AsyncLocalStorage). Configurable con `auditColumns` (o `null` para desactivar).
- `updateByPk` usa `preload + save`: corren los listeners (`@BeforeUpdate`) y se pueden actualizar relaciones.
- Transacciones: `dataSource.transaction(async (manager) => service.create(dto, { manager }))`.

### Errores

`GlobalExceptionFilter` traduce errores de Postgres a HTTP: unique `23505` → 409, FK `23503` → 409, not-null `23502` → 400, formato `22P02` → 400… En producción los 500 no exponen detalles internos.

### Seguridad

- `JwtAuthGuard` (global) **verifica la firma** del token (RS/ES con `JWT_PUBLIC_KEY`, HS con `JWT_SECRET`) y su expiración. Rutas públicas con `@Public()`.
- Rate limiting global (`THROTTLE_*`) y estricto en login (5/min).
- Helmet activo; CORS por allowlist (`CORS_ORIGINS`).
- Cliente HTTP saliente (`HttpClientService`) con TLS verificado y timeout.

## Estructura

```text
src/
  common/
    controller/crud-controller.factory.ts   # factory de controladores CRUD
    services/base.service.ts                # servicio CRUD genérico
    query/query-string-parser.ts            # parser del contrato de filtros
    context/                                # RequestContext (ALS) + interceptor
    guards/ decorators/ filters/ http/ logger/ responses/ utils/
  config/database/                          # conexión, data-source CLI y migraciones
  modules/
    health/  login/  notification/          # notification = módulo de referencia CRUD
test/                                       # espejo de src/ con subcarpetas por módulo
```

## Tests

```bash
bun test
```

Los tests viven en `test/` espejando `src/` (`test/common/query/…`, `test/modules/health/…`). El parser de filtros y `BaseService` tienen suites unitarias sin base de datos; health tiene e2e con `app.inject()`.
