# PostgreSQL local para integration tests

Infraestructura exclusiva de Nest Base: PostgreSQL 17 en Docker Compose,
usuario y base `nest_base_test`, puerto loopback 5434 y volumen
`nest-base-tests_nest-base-postgres-test-data`. No utiliza PostgreSQL de
desarrollo, Supabase ni recursos de AI-Trading-Platform.

Desde la raíz del repositorio:

```powershell
bun run test:postgres:setup
bun run test:postgres:verify
bun run test:postgres
bun run test:postgres:stop
```

Setup genera una contraseña aleatoria en `.env.test` (ignorado por Git),
comprueba que 5434 esté libre al crear la configuración y espera el healthcheck.
Luego verifica conexión, identidad y permisos CREATE/DROP SCHEMA. Si el puerto
está ocupado, seleccionar otro puerto local libre en la configuración antes de
levantar Compose. Conservar iguales el puerto y la URL. No mostrar el archivo
ni ejecutar `docker compose config` sin `--quiet`: contiene secretos.

El runner usa `NEST_BASE_TEST_DATABASE_URL` del entorno o del archivo local.
Rechaza hosts remotos y nombres de usuario/base ajenos a esta infraestructura.
La suite falla si falta configuración; no se omite silenciosamente.
Cada ejecución crea un schema aleatorio `nest_base_scope_<uuid>`, crea tablas
mediante DDL explícito (sin synchronize), limpia en finally y comprueba que su
schema desapareció. No elimina schemas de otras ejecuciones.

`stop` detiene el servicio sin borrar contenedor ni volumen. `setup` vuelve
a levantarlo y reutiliza las credenciales. No borrar `.env.test` mientras se
conserve el volumen: PostgreSQL conserva la contraseña inicial.
La eliminación de datos no es automática.

Evidencia inicial 2026-09-21: healthcheck, conexión y CREATE/DROP SCHEMA PASS;
21 tests PostgreSQL PASS, incluidos EntityManager, estado no confirmado,
rollback y concurrencia entre partitions. Ver el [cierre de 516 tests](scope-authorization-migration.md) para los
gates globales de promoción/packaging.
