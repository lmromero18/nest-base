# Standard CRUD module generator

The project-local generator creates a deterministic standard CRUD module. Root registration is a separate, explicit opt-in; migrations always remain human-reviewed.

When no profile is specified, the generator uses the `table-crud` profile.
`view` and read-only profiles are reserved for a future release and are not
part of the core package promotion slice.

## Quick path

```bash
bun run module:generate -- --dry-run catalogo-tipo-documento
bun run module:generate -- catalogo-tipo-documento
bun run module:generate -- --dry-run --register catalogo-tipo-documento
bun run module:generate -- --register catalogo-tipo-documento
```

Review the dry-run plan first. `--register` is required to edit roots. A registration invocation writes only after the complete nine-output plan passes structural preflight and collision checks.

## Generated paths

The command creates six source files under `src/modules/<module>/`:

- `<module>.module.ts`
- `<module>.controller.ts`
- `<module>.service.ts`
- `<module>.entity.ts`
- `dto/create-<module>.dto.ts`
- `dto/update-<module>.dto.ts`

It also creates `test/modules/<module>/<module>.service.spec.ts`, a focused contract test for the generated service.

## Safety behavior

- Names must be lowercase Spanish `kebab-case`; reserved and special-purpose names, including WebSocket names, are rejected.
- Existing source or generated-test destinations refuse the whole operation by default. Nothing is overwritten.
- Files are rendered and staged in temporary sibling directories, then guarded renames publish both module trees.
- A failed publish removes staged files and any output created by that attempt.
- If cleanup itself fails, the command reports the affected path instead of hiding
  the rollback problem.
- `--dry-run` performs no writes, renames, or directory creation.
- Without `--register`, root files, migrations, and existing modules are never modified.

## Opt-in registration

`--register` adds exactly one module and one entity registration for the generated name:

| Root                                 | Import                                                         | Member                        |
| ------------------------------------ | -------------------------------------------------------------- | ----------------------------- |
| `src/app.module.ts`                  | `ProductoModule` from `./modules/producto/producto.module`     | `@Module({ imports: [...] })` |
| `src/config/database/data-source.ts` | `ProductoEntity` from `../../modules/producto/producto.entity` | `entities: [...]`             |

The editor accepts only the supported canonical TypeScript structures and preserves existing unrelated text and line endings. It refuses missing, malformed, unsupported, duplicate, partial, mismatched, or colliding roots before any write. An exact rerun reports `already registered` and is byte-stable.

Registration stages all seven generated files and both root candidates before publication. If publication or cleanup fails, the operation reports the primary, rollback, and cleanup outcomes, restores changed roots, removes this run's generated output, and leaves no staging or backup artifacts. A preview performs the same validation but leaves the temporary project byte-identical.

## Manual follow-up

After a successful registration, review the generated entity and then handle the migration manually:

1. Create a migration, choosing and reviewing the migration name and path:
   ```bash
   bun run migration:generate -- src/config/database/migrations/AddProducto
   ```
2. Review the generated SQL and entity/table mapping. The generated table follows `tb_<snake_case_module>` (for example, `orden-compra` becomes `tb_orden_compra`).
3. Inspect pending migration state:
   ```bash
   bun run migration:show
   ```
4. After human review and database checks, apply it:
   ```bash
   bun run migration:run
   ```

Run the focused generated test and repository checks before committing. Registration does not create, rewrite, execute, revert, or roll back migrations and does not mutate a database.

## Explicit exclusions

Automatic migration creation or execution, migration rollback, notifications, authentication/login, health, WebSocket, special-purpose modules, broad schematics, stock Nest CLI replacement, and package extraction are explicitly out of scope. Those require separate, explicitly designed work.

# Module generator

The generator's default profile is `table-crud` when no profile is specified.
It emits the repository's standard entity, DTO, service, controller, module,
and contract-test files. `view` and read-only profiles are planned future
profiles; they are not silently selected and are outside the core package
slice.
