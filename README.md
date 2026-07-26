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

## Scripts

```bash
bun run start:dev          # desarrollo con watch
bun run start:prod         # producción (TypeScript directo con Bun)
bun run build              # compila a dist con tsc (nest build)
bun run typecheck          # tsc --noEmit
bun run lint               # eslint --fix
bun test                   # unit + e2e (test/ con subcarpetas por módulo)
bun run migration:run      # aplica migraciones
bun run migration:generate src/config/database/migrations/NombreCambio
```

---

## La librería base

### Crear un módulo CRUD

**1. Service** — extiende `BaseService` y declara qué expone:

```ts
@Injectable()
export class PersonaService extends BaseService<Persona> {
  protected override readonly filterable = ['nombre', 'estado', 'ciudad.nombre'];
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

**2. Controller** — la factory recibe los DTOs reales (ahí vive la validación) y las rutas a exponer:

```ts
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

Rutas disponibles: `find` (GET /), `findOne` (GET /:id), `create` (POST), `update` (PATCH /:id), `softDelete` (DELETE /:id), `hardDelete` (DELETE /:id/hard), `restore` (PATCH /:id/restore). Por defecto no se exponen `hardDelete` ni `restore`. `softDelete`/`restore` requieren `@DeleteDateColumn` en la entidad (si falta, responden 405).

> Los genéricos de TypeScript se borran al compilar: un `@Body() data: CreateDto` genérico llega al pipe como `Object` y no se valida. Por eso la factory inyecta los DTOs con `expectedType`. Regla derivada: los DTOs de `@Body` se importan **como valor**, nunca con `import type`.

### Contrato de query-string en listados

```text
GET /api/v1/personas?estado=ACTIVO&nombre_like=ana&page=2&perPage=50
```

| Sintaxis | Significado |
|---|---|
| `campo=v` | igualdad (repetido → `IN`) |
| `campo_like=v` | `ILIKE %v%` (castea no-texto) |
| `campo_gte=v` / `campo_lte=v` | `>=` / `<=` |
| `campo_between=a,b` | rango (malformado → 400) |
| `campo_null=true\|false` | `IS NULL` / `IS NOT NULL` |
| `campo_not=a,b` | `NOT IN` |
| `relacion.campo=v` | filtro sobre relación (ruta completa validada) |
| `with=rel,rel.sub` | carga relaciones permitidas |
| `orderBy=campo:DESC,otro` | ordenamiento (allowlist) |
| `or=[{"a":1},{"b":2}]` | bloques OR (solo igualdad) combinados con el AND base |
| `page` / `perPage` | paginación; `perPage` tiene tope (`maxPerPage`); `perPage=0` solo si el service define `allowUnpaginated` |

Todo campo/relación fuera de la allowlist se ignora en silencio. La respuesta de listado es:

```json
{ "data": [], "total": 0, "currentPage": 1, "lastPage": 1, "perPage": 20, "from": null, "to": null }
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
