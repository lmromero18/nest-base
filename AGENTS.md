# NEST-BASE — Project Agents

Extiende la configuración global de gentle-ai con reglas y agentes específicos del proyecto.

---

## Project Context

- **Stack**: NestJS v11 (Fastify) + TypeORM + PostgreSQL + Bun (runtime)
- **Package manager**: Bun (`bun install`, lockfile `bun.lock`)
- **Testing**: `bun test` (spec files junto al código en `src/`, e2e en `test/`)
- **Linting**: ESLint flat config (`eslint.config.mjs`) + Prettier
- **Language**: TypeScript con `nodenext` module resolution
- **Decorators**: habilitados (`experimentalDecorators`, `emitDecoratorMetadata`)
- **Arquitectura**: Modular con `src/modules/<modulo>/` y capa compartida en `src/common/`

---

## Coding Rules

### Module Structure

Cada módulo de dominio en `src/modules/<modulo>/` sigue esta estructura:

```
src/modules/<modulo>/
  <modulo>.module.ts        # @Module() principal
  <modulo>.controller.ts    # Controlador (opcional, según necesidad)
  <submodulo>/              # Submódulos o agrupaciones lógicas
    <submodulo>.module.ts
    <submodulo>.service.ts
    dto/
      create-<entidad>.dto.ts
      update-<entidad>.dto.ts
      <entidad>.dto.ts       # DTOs de consulta/response
    <entidad>.service.ts     # Opcional, puede estar en el submódulo
```

### Naming Conventions

| Elemento | Convención | Ejemplo |
|----------|-----------|---------|
| Directorios de módulos | `kebab-case` en español | `catalogo-tipo-documento/` |
| Clases (services, controllers) | `PascalCase` + sufijo inglés | `NotificationService`, `HealthController` |
| DTOs | `PascalCase` + sufijo `Dto` | `CreateNotificationDto` |
| Entities | `PascalCase` + sufijo `Entity` | `NotificationEntity` |
| Archivos | `kebab-case` | `notification.service.ts`, `notification.entity.ts` |
| Métodos | `camelCase` | `processEmailBatch()`, `markSent()` |
| Variables/Propiedades | `camelCase` | `idUsuario`, `tsScheduledAt` |
| Columnas en BD | `snake_case` con prefijo `tb_` para tablas | `id_notification`, `nb_subject` |

### TypeORM Entities

- Nombre de tabla con esquema: `@Entity({ name: 'tb_<nombre>', schema: '<esquema>' })`
- Primary key auto-incremental: `@PrimaryGeneratedColumn({ name: 'id_<entidad>', type: 'int' })`
- Columnas con `name` explícito en snake_case y tipo declarado
- `nullable: true` en columnas opcionales
- Usar `default: () => "'VALOR'"` para defaults literales, `default: () => 'CURRENT_TIMESTAMP'` para timestamps
- Relaciones: `@ManyToOne`, `@OneToMany` con `@JoinColumn` explícito
- Unique constraints: `@Unique('tb_<tabla>_un_<campo>', ['<campo>'])`
- Auditoría: `idCreado`, `idActualizado`, `ts_fecha_timestamp_ins`, `ts_fecha_timestamp_upd`

### Services

- `@Injectable()` + Logger: `private readonly logger = new Logger(NombreService.name)`
- Inyección por constructor con `@InjectDataSource(namedConnection)`
- Transacciones: `dataSource.transaction(async (manager) => { ... })`
- Validación manual con `class-validator`: `validate(dto)` después de `plainToInstance`
- Errores: `BadRequestException`, `NotFoundException`, `ConflictException` según el caso
- Métodos `private` para helpers de lectura/mapeo (`readString`, `readNumber`, `readBoolean`)

### Response Format

Usar `SuccessResponse` de `src/common/responses/success.response.ts` para respuestas exitosas:

```typescript
return {
  message: RESPONSE_MESSAGES.MODULO.OPERACION_EXITOSA,
  data: { ... }
};
```

### Import Paths

- Usar imports relativos desde el archivo hacia `../../../common/` para la capa compartida
- NO usar path aliases del tsconfig a menos que sea estrictamente necesario

### Logging

- Winston configurado como logger global de NestJS (nest-winston)
- Logs estructurados con rotación diaria
- El Logger de NestJS se usa en servicios para trazabilidad
- Niveles: `debug` para flujo detallado, `log` para operaciones exitosas, `warn` para advertencias, `error` para fallos

### Testing

- Todos los tests viven en `test/`, espejando la estructura de `src/` con subcarpetas por módulo:
  `test/common/services/base.service.spec.ts`, `test/modules/health/health.e2e.spec.ts`
- Usar `bun test` (API compatible con Jest; importar `describe/it/expect` desde `bun:test`)
- Mocks manuales o con `@nestjs/testing` para módulos
- E2E con `FastifyAdapter` + `app.inject()` (archivos `*.e2e.spec.ts`)

---

## SDD Context

Cuando se use SDD (Spec-Driven Development), aplicar estas convenciones del proyecto:

- **Stack detectado**: NestJS v11 + TypeORM + PostgreSQL + class-validator
- **Test runner**: `bun test`
- **Estructura de módulos**: feature-folders con `common/` compartido
- **Patrón dominante**: Servicios transaccionales con validación explícita
- **Convención de naming**: kebab-case español para módulos, PascalCase inglés para clases
- **Idioma**: El código fuente (clases, métodos, variables, entidades) usa naming bilingüe (tablas/columnas en español, clases/métodos en inglés). Comentarios en español neutro.

---

## Custom Agents

### @BASE/check-conventions
Revisa que los archivos nuevos sigan las convenciones de naming, estructura y TypeORM definidas arriba.

### @BASE/entity
Crea una nueva entidad TypeORM siguiendo las convenciones del proyecto: tabla con el esquema configurado, columnas en snake_case con nombre explícito, relaciones, campos de auditoría.

### @BASE/catalogo
Crea un módulo de catálogo completo (entity, service, controller, DTOs, module) para una tabla de referencia, siguiendo el patrón de catálogos descrito arriba.

### @BASE/response-format
Revisa que los controladores usen `SuccessResponse` y `RESPONSE_MESSAGES` consistentemente, y que los errores usen las excepciones HTTP correctas de NestJS.

---

## Instructions

- No usar path aliases del tsconfig en imports
- Los DTOs siempre llevan decoradores de `class-validator`
- Las entidades TypeORM siempre llevan `@Entity` con `name` y `schema` explícitos
- Las transacciones se manejan con `dataSource.transaction()`; los métodos de `BaseService` aceptan `{ manager }` para participar en ellas
- Los métodos privados de lectura/mapeo van al final del service, después de los métodos públicos
- Auditoría: `idCreado`/`idActualizado` los estampa automáticamente `BaseService` desde `RequestContext` (AsyncLocalStorage) cuando esas columnas existen en la entidad; no mutar el body ni setearlos a mano
- CRUD estándar: el service extiende `BaseService<Entidad>` (con `filterable`/`sortable`/`allowedRelations`) y el controller extiende `CrudControllerFactory<Entidad>({ createDto, updateDto, routes })`; los DTOs de `@Body` se importan como valor (nunca `import type`)
- Logger de NestJS inyectado con `new Logger(NombreClase.name)` como propiedad privada
- Los archivos se formatean con Prettier antes de commit
- No usar `--force` ni flags inseguros en comandos
- Commits en inglés con conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`)
