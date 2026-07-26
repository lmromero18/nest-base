# CENSO API — Project Agents

Extiende la configuración global de gentle-ai con reglas y agentes específicos del proyecto.

---

## Project Context

- **Stack**: NestJS v11 + TypeORM + PostgreSQL
- **Package manager**: pnpm
- **Testing**: Jest (spec files junto al código en `src/`)
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
| Directorios de módulos | `kebab-case` en español | `catalogo-condicion-vivienda/` |
| Clases (services, controllers) | `PascalCase` + sufijo inglés | `RegistroService`, `SensoController` |
| DTOs | `PascalCase` + sufijo `Dto` | `CreateSensoRegistroDto` |
| Entities | `PascalCase` + sufijo `Entity` | `PersonaEntity` |
| Archivos | `kebab-case` | `registro.service.ts`, `persona.entity.ts` |
| Métodos | `camelCase` | `buildRegistroDto()`, `registrar()` |
| Variables/Propiedades | `camelCase` | `idPersona`, `coReferenciaPersona` |
| Columnas en BD | `snake_case` con prefijo `tb_` para tablas | `id_persona`, `nb_nombre` |

### TypeORM Entities

- Nombre de tabla con esquema: `@Entity({ name: 'tb_<nombre>', schema: 'donacion' })`
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

- Tests unitarios junto al código fuente: `*.spec.ts`
- Usar Jest con `ts-jest` para transformación
- Mocks manuales o con `@nestjs/testing` para módulos
- Test con supertest para E2E (en `test/`)

---

## SDD Context

Cuando se use SDD (Spec-Driven Development), aplicar estas convenciones del proyecto:

- **Stack detectado**: NestJS v11 + TypeORM + PostgreSQL + class-validator
- **Test runner**: Jest
- **Estructura de módulos**: feature-folders con `common/` compartido
- **Patrón dominante**: Servicios transaccionales con validación explícita
- **Convención de naming**: kebab-case español para módulos, PascalCase inglés para clases
- **Idioma**: El código fuente (clases, métodos, variables, entidades) usa naming bilingüe (tablas/columnas en español, clases/métodos en inglés). Comentarios en español neutro.

---

## Custom Agents

### @CENSO/check-conventions
Revisa que los archivos nuevos sigan las convenciones de naming, estructura y TypeORM definidas arriba.

### @CENSO/entity
Crea una nueva entidad TypeORM siguiendo las convenciones del proyecto: tabla con esquema `donacion`, columnas en snake_case con nombre explícito, relaciones, campos de auditoría.

### @CENSO/catalogo
Crea un módulo de catálogo completo (entity, service, controller, DTOs, module) para una tabla de referencia, siguiendo el patrón de `catalogo-condicion-vivienda` o `catalogo-neurodivergencia`.

### @CENSO/response-format
Revisa que los controladores usen `SuccessResponse` y `RESPONSE_MESSAGES` consistentemente, y que los errores usen las excepciones HTTP correctas de NestJS.

---

## Instructions

- No usar path aliases del tsconfig en imports
- Los DTOs siempre llevan decoradores de `class-validator`
- Las entidades TypeORM siempre llevan `@Entity` con `name` y `schema` explícitos
- Las transacciones se manejan con `dataSource.transaction()`, no con `@Transactional`
- Los métodos privados de lectura/mapeo van al final del service, después de los métodos públicos
- Auditoría: `idCreado` se setea en creación, `idActualizado` en actualización
- Logger de NestJS inyectado con `new Logger(NombreClase.name)` como propiedad privada
- Los archivos se formatean con Prettier antes de commit
- No usar `--force` ni flags inseguros en comandos
- Commits en inglés con conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`)
