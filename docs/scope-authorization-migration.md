# Scope y metadata de autorización — siguiente versión

Estado: implementación local, sin publicación. Los paquetes publicados consultados el 2026-09-13
fueron core 0.1.0 y http-core 0.1.0; esto no afirma el estado actual de npm. El checkout local contiene trabajo adicional;
la coincidencia del número de versión no certifica igualdad de artefactos.

## Fronteras

Core conserva TypeORM, queries, identidad mínima y errores de aplicación.
HTTP Core genera rutas y adjunta metadata opaca. La aplicación decide quién
interpreta esa metadata y qué política aplica. No existe autorización automática
por publicar documentación Bearer en Swagger.

## API de scope

BaseService incorpora estas extensiones protegidas:

- requireScope: boolean, false por defecto.
- buildScope(context: ScopeContext): ScopeWhere<T> | readonly ScopeWhere<T>[] | undefined.
- prepareMutation(data: DeepPartial<T>, context: ScopeContext): DeepPartial<T>.

ScopeContext contiene operation y el manager opcional de esa llamada.
Las operaciones son find, findOne, findByPk, findOneBy, count, exists, create,
update, delete, softDelete y restore. Las variantes por columna única usan
update/delete. El scope se construye en cada llamada y nunca se cachea.

ScopeWhere<T> representa igualdades sobre columnas raíz: strings, números finitos,
booleanos y fechas válidas. No acepta null/undefined, objetos anidados,
FindOperator, propiedades inexistentes ni ramas vacías. No se infiere autoridad
de relaciones o de valores ignorables por TypeORM.

Esta primera API usa deliberadamente igualdades, no predicados SQL arbitrarios.
Cada objeto es una conjunción; un array representa alternativas. Se admiten
hasta 64 alternativas y 256 combinaciones con las ramas del caller.
Un scope inválido siempre falla; no se convierte en acceso global.

Ejemplo neutral:

```typescript
import { BaseService } from '@nest-base/core';
import type { ScopeContext, ScopeWhere } from '@nest-base/core';

class RecordService extends BaseService<RecordEntity> {
  protected override readonly requireScope = true;

  protected override buildScope(
    _context: ScopeContext,
  ): ScopeWhere<RecordEntity> | undefined {
    const partition = this.currentPartition();
    return partition === undefined ? undefined : { partition };
  }

  // currentPartition() pertenece a la especialización consumidora.
}
```

## AND y OR

Scope { partition: 'a' } + caller { state: 'active' } exige ambas condiciones.

Scope { partition: 'a' } + caller { partition: 'b' } produce una contradicción,
no reemplaza una condición por otra: no devuelve filas.

Con caller OR, el scope se aplica a cada rama. Con scope OR, se distribuye el
producto de alternativas, preservando (caller A OR B) AND (scope X OR Y).
Las colisiones de columnas utilizan And/Equal de TypeORM. No se muta el objeto
de filtros original.

## Fail closed

requireScope=true con buildScope() undefined lanza ApplicationException
con code scope-required antes de ejecutar consultas. Los scopes malformados
lanzan invalid-scope incluso si requireScope=false.

Un servicio sin scope conserva rutas de persistencia y defaults anteriores.
La lectura por ID, columna única, count y exists no son excepciones al scope.

## Creación y actualización

prepareMutation permite rechazar, normalizar o añadir campos. Recibe una copia
superficial del payload; una especialización que modifique objetos anidados debe
copiarlos también. El framework sanea columnas protegidas después del hook.

Las igualdades comunes a todas las alternativas se imponen desde el scope sobre
el payload. El cliente no puede reasignarlas. Si se prefiere rechazar un intento,
prepareMutation puede lanzar un error antes de esa imposición.

En creación con alternativas, los valores preparados deben satisfacer una rama
completa. No se elige una rama automáticamente. En actualización no se permite
reasignar una columna de scope cuyo valor varíe entre alternativas.

Las creaciones scoped usan INSERT, sin upsert implícito por una PK natural.
Devuelven la entidad preparada y los campos generados disponibles en InsertResult.
Las actualizaciones scoped usan UPDATE con scope y PK en el predicado SQL, y
después consultan la fila por PK y scope. Una prelectura no reemplaza ese guard.

El scope permanece en DELETE, soft-delete y restore. Restore puede actuar sobre
una fila borrada lógicamente sin depender de un findOne que la oculte.

Optar por scope implica semántica de mutación directa: no se conserva el ciclo
preload/save, sus cascadas ni todos sus listeners de entidad. Las escrituras de
relaciones se rechazan explícitamente con scoped-relation-write. Las PK no se
reasignan en update. Las operaciones de grafo y cambios de autoridad requieren
casos de uso transaccionales específicos, no casts para saltar estas restricciones.

Un update fuera del scope devuelve null; delete/soft-delete/restore devuelven
false. Los hooks y subscribers de la aplicación son código confiable: no deben
cambiar campos de autoridad después de su validación.

## Relaciones

Filtros y carga de relaciones mantienen el scope de la fila raíz. Esto NO aplica
una política independiente sobre cada fila relacionada. La aplicación debe
garantizar sus invariantes relacionales, restringir allowedRelations y usar
consultas específicas cuando el recurso relacionado tenga otra política.

Los predicados de scope sobre relaciones no están soportados por esta API:
se rechazan, sin degradación silenciosa.

## Manager y transacciones

Todas las mutaciones conservan MutationOptions.manager. Las lecturas aceptan
manager en sus opciones; count/exists lo aceptan como segundo argumento.
ScopeContext recibe el mismo manager. No se sustituye por el repositorio global.

BaseService no abre una transacción automáticamente. Si el caller necesita
atomicidad de varias operaciones o una instantánea para la respuesta posterior
a update, debe proporcionar su EntityManager transaccional.
El predicado de la escritura permanece protegido incluso sin esa transacción.

## Metadata HTTP y cobertura estricta

```typescript
import { CrudControllerFactory } from '@nest-base/http-core';

const ReadController = CrudControllerFactory<RecordEntity>({
  routes: ['find', 'findOne'],
  authorization: {
    find: [{ key: 'record-policy', value: { action: 'read-list' } }],
    findOne: [{ key: 'record-policy', value: { action: 'read-one' } }],
  },
  strictAuthorizationCoverage: true,
});
```

Cada policy contiene key (string no vacío o symbol) y value explícito.
Se permite adjuntar varias claves distintas por método. La aplicación consume
esos valores mediante Reflector/metadata de Nest. HTTP Core no interpreta
ANY/ALL, privilegios, roles ni credenciales.

Con strictAuthorizationCoverage=true cada ruta habilitada debe tener al menos
una entrada. Las rutas deshabilitadas no requieren policy. Las rutas desconocidas,
mapas malformados, entradas vacías y claves repetidas fallan en la factory.
Un value vacío como [] es una decisión explícita del consumidor, no una semántica
especial del framework. La configuración de metadata debe tratarse como inmutable.

Sin authorization y sin modo estricto se conserva la generación anterior.
Las rutas custom añadidas por un controller hijo son responsabilidad de la
aplicación. Sobrescribir métodos generados requiere conservar o redeclarar
decoradores HTTP, validación y metadata; strict coverage verifica la factory,
no código añadido después por el consumidor.

## Identidad y errores

Principal continúa limitado a subject y clientId opcionales. RequestContextStore
conserva requestId y añade correlationId opcional; no añade permisos.
La aplicación debe usar la misma instancia/import de RequestContext al escribir
el contexto y al consumir core.

HTTP Core exporta ApplicationExceptionFilter, opt-in. Traduce validation=400,
not-found=404, conflict=409 y unsupported=405. La respuesta incluye statusCode,
error (categoría) y code; nunca publica automáticamente message ni details.
Los códigos se consideran identificadores públicos estables. La aplicación
controla mensajes para UX y logging interno.

Debe registrarse respetando la prioridad frente a filtros catch-all existentes.
ApplicationException y el filtro deben resolver la misma instalación de core.
El filtro no reemplaza validación de DTO ni tratamiento de otros errores.

## Compatibilidad y migración desde 0.1.0

- No cambian versiones de manifiestos ni lockfile en esta tarea.
- No cambian defaultPerPage=20, maxPerPage=500 o allowUnpaginated=true.
- No cambian rutas ni envelopes existentes por defecto.
- Scope y strict coverage son opt-in.
- Los consumidores scoped aceptan explícitamente las nuevas reglas de escritura.
- Persistir relaciones/cascadas sigue disponible en servicios sin scope.
- Usar imports públicos para ScopeWhere, ScopeContext y ScopeOperation.
- Portar políticas y scope desde una especialización requiere pruebas por todas
  las operaciones, no solo sustituir imports.
- La validación de configuración inválida produce errores tempranos deliberados.

Recomendación: 0.2.0 para ambos paquetes por incorporar APIs públicas nuevas,
sin llegar a 1.0.0 ni tratarlo como un simple patch. Antes de una publicación
coordinada habrá que revisar el peer range de http-core (actualmente <0.2.0)
y sus gates de empaquetado. No se cambian esos metadatos ni se publica aquí.

## Evidencia y límites

Las pruebas nuevas cubren scope, alternativas AND/OR, mutaciones, fail closed,
repositorio transaccional, metadata por ruta, errores y aislamiento del contexto.
Las pruebas SQL usan el compilador PostgreSQL real de TypeORM sin conexión.
La integración adicional contra PostgreSQL 17 Docker verifica transacciones,
rollback y aislamiento real; su alcance y resultados se detallan en el cierre
2026-09-21. El test de compilación SQL sigue siendo una evidencia diferente.

No se aceptan como columnas de scope las versiones, fechas automáticas de actualización/borrado ni columnas mapeadas como relaciones. TypeORM puede modificarlas implícitamente; deben usarse columnas raíz estables de autoridad.

## Historial de validación — 2026-09-13 (reemplazado por el cierre posterior)

Implementación: commit df7709b, branch feature/generic-scope-authorization.
Estado en esa fecha: implementación disponible para revisión; gate global NO aprobado.
Los fallos siguientes se corrigieron en el cierre 2026-09-21.

| Verificación                             | Resultado                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| Baseline, antes de cambios               | 381 tests: 379 PASS, 2 FAIL (timeouts de promoción serial/concurrente), 621,21 s |
| Tests añadidos                           | 99: 64 scope, 25 metadata HTTP, 4 errores, 1 contexto, 5 SQL                     |
| Suite final completa                     | 480 tests: 477 PASS, 3 FAIL, 1 error asíncrono adicional; 565,31 s               |
| Selección scope/common/arquitectura/HTTP | 194 PASS, 0 FAIL                                                                 |
| lint y quality:check                     | PASS (focused-check, lint, formato, typecheck y diff)                            |
| build, build:core, build:http-core       | PASS                                                                             |
| typecheck                                | PASS                                                                             |

Fallos de la suite final, todos en test/packages/core/promotion-sequence.spec.ts:

- Promoción serial: las dos promociones completaron, pero el test excedió 120 s
  (121,223 s). El baseline ya fallaba por timeout.
- Promoción concurrente: excedió 120 s; también fallaba en el baseline.
  La terminación produjo además una aserción asíncrona con exit code 143.
- Build directo concurrente con promoción: agotó los 30 s de espera del lock de
  salida. La promoción terminó correctamente. Este fallo NO estaba en el
  baseline. Se reprodujo aislado: 0 PASS, 1 FAIL, 40 filtrados, 60,96 s.

La ejecución aislada confirmó PASS de los checkpoints de promoción, incluidos
auditoría de core/http-core, tarballs y consumidores. Esto no reemplaza el fallo
de coordinación ni convierte la suite completa en PASS. No se aumentaron
timeouts ni se deshabilitaron pruebas para obtener un resultado verde.

Warnings observados: normalización LF/CRLF de Git y logs de errores HTTP
esperados por tests. Yarn no está disponible; Bun, npm y pnpm sí.
No se ejecutó una integración con PostgreSQL real.
El directorio preexistente packages/create-nest-base/.atl/ permanece intacto
y excluido de los commits. No se publicó npm ni se hizo merge/push.

## Cierre de gates — 2026-09-21

Revisión documental y preparación de commits locales: 2026-09-22. No se
repitieron las verificaciones ya aprobadas; las cifras siguientes corresponden
a la ejecución del 2026-09-21.

Veredicto: **READY TO MERGE**. No se hizo merge, push ni publicación.
La validación se ejecutó en Windows con Bun 1.3.14 y PostgreSQL 17 Docker.
El código funcional de BaseService y metadata HTTP no cambió en este cierre.

### Resultados finales

| Gate                                     | Evidencia                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Baseline histórico pre-feature (2993344) | 381 tests, 379 PASS, 2 FAIL; ejecución anterior del 2026-09-13                      |
| Estado recibido                          | 480 tests, 477 PASS, 3 FAIL, 1 error asíncrono                                      |
| Nuevos tests en este cierre              | 36: PostgreSQL 21, HTTP real 6, límites 5, tooling 4                                |
| Suite completa final                     | **516 PASS, 0 FAIL, 0 skipped, 0 errores asíncronos**; 54 archivos; 469,42 s        |
| Scope unitario                           | 69 PASS; además 5 pruebas de SQL compilado y 21 de PostgreSQL real                  |
| Authorization metadata                   | 25 PASS; además 1 controller consumidor real en Fastify                             |
| Exception filter                         | 4 PASS unitarios; 4 mappings HTTP reales y 1 interacción con catch-all              |
| PostgreSQL                               | conexión, CREATE/DROP SCHEMA, CRUD, EntityManager, rollback y concurrencia PASS     |
| Packaging                                | core/http-core, tarballs, consumidores independientes, ESM, CJS y declarations PASS |
| lint / formato / typecheck / diff        | PASS mediante quality:check                                                         |
| build / build:core / build:http-core     | PASS ejecutados también después de la suite                                         |
| Secretos y limpieza                      | .env.test ignorado; sin credenciales en archivos versionables; 0 schemas temporales |
| Adversarial review                       | scopes obligatorios, OR, autoridad contextual, managers y strict coverage PASS      |

No se volvió a ejecutar el baseline antiguo en este cierre. Se conservan sus
resultados anteriores y se verificó directamente en Git que los defectos de
GetOwner y lock global existían en 2993344. No quedan fallos históricos en la
suite final actual. El total 516 incluye las pruebas de PostgreSQL, no las suma
dos veces ni cuenta los comandos de build como tests.

### Clasificación y causa de los fallos recibidos

Archivo común: test/packages/core/promotion-sequence.spec.ts.

**A. runs the complete promotion twice serially with clean output state**

- Error original: test timed out after 120000ms; ambas promociones terminaban,
  pero el total excedía el límite (121,223 s en la ejecución recibida).
- Anterior a la feature: sí, ya fallaba en el baseline histórico. Dependiente
  del tiempo de ejecución/carga, no una divergencia funcional de CRUD.
- Causa: overhead repetido del tooling, incluida la captura Windows incorrecta
  de identidad y compilación duplicada de declarations de HTTP Core.
  Get-CimInstance devuelve CimInstance: GetOwner se invoca mediante
  Invoke-CimMethod, no con el método .GetOwner() del antiguo objeto WMI.
  El error provocaba capturas nulas y repetición del camino de captura.
- Relación: build/promoción y lifecycle; no scope/authorization. No requiere
  concurrencia para manifestarse.
- Corrección: invocación CIM válida con prueba de identidad real; emitir
  declarations junto al build ESM, conservando los mismos artefactos públicos.
- Final: PASS, 111,687 s, límite original 120 s.

**B. isolates concurrent complete promotions**

- Errores originales: Promotion child ... exceeded its deadline / timeout del
  test de 120 s. Existía en baseline; reproducible bajo la contención previa,
  dependiente de duración y orden.
- Causa: promociones aparentemente aisladas usaban el mismo lock global y
  outputs de HTTP Core del repositorio. Una cadena completa serializaba a la
  otra, aunque tuviesen run roots distintos.
- Relación: build/promoción, ownership/cleanup y concurrencia; no CRUD.
- Corrección: core y HTTP Core tienen outputs por run root y lock propio.
  Solo la instalación frozen comparte un lock acotado sobre node_modules.
  Los tokens heredados se validan contra el lock del recurso solicitado.
- Final: PASS, 67,116 s, sin aumentar el timeout.

**C/D. coordinates a direct repository build with a concurrent promotion / lock**

- Error recibido: Timed out after 30000ms waiting for core output lock
  en acquireLock, tools/core-run-context.ts; el test esperaba [0, 0].
- No falló en el baseline reportado; sí se reprodujo aislado con la feature.
  El defecto de diseño estaba antes: la promoción retenía el recurso global
  por más tiempo que la espera del build. Condicionalmente determinista
  cuando esa retención excede los 30 s.
- El recurso era el directorio de lock con owner.json bajo TEMP; la promoción
  lo adquiría y liberaba en finally. El build era el waiter. La sección
  crítica incluía procesos hijos, installs, builds, auditorías y consumidores.
- Corrección: lock propio por workspace; la promoción no borra ni reemplaza
  outputs de un build directo. La copia de core excluye dist, .dist-backup,
  .build-work, .build-types y node_modules. Tests verifican conservación del
  artefacto compartido y exclusión de inputs transitorios.
- Durante diagnóstico se observó también EPERM al renombrar dist concurrente;
  el build individual pasó. La suite final pasa tras excluir outputs en
  construcción. No se atribuye ese error exclusivamente a OneDrive: no hay
  evidencia para afirmar esa causalidad.
- Relación: build, cleanup y concurrencia; no predicados de scope.
- Final: PASS, 54,245 s. Espera del lock de build conservada en 30 s.

**E. error asíncrono asociado a la promoción concurrente**

- Error recibido: Unhandled error between tests, expected exit code 0,
  received 143, en la espera del hijo terminada después del timeout exterior.
- No se registró en el baseline recibido. Reproducido en la suite anterior,
  dependiente del orden de timeout/terminación.
- Causa: esperas de hijos secuenciales y lifecycle sin join completo en finally,
  combinado con identidad Windows fallida y tiempo excesivo de promoción.
- Corrección: todas las esperas se registran inmediatamente con Promise.all;
  finally termina y espera a todos los hijos mediante allSettled. La captura
  de identidad real y las pruebas de PID reutilizado siguen activas.
- Relación: lifecycle/concurrencia de tests y tooling, no scope/authorization.
- Final: cero errores asíncronos y ningún aviso de proceso dangling en la suite.

La limpieza de roots antiguos protege también el lock propio de cada root;
un root activo no se elimina por ser antiguo. Los tests de fallos forzados,
cuarentena, reemplazo de owner y recuperación permanecen activos. No se
añadieron sleeps, retries de tests ni se aumentaron límites para obtener verde.

### Evidencia PostgreSQL y semántica de mutaciones

Ver [operación de la base de tests](postgres-tests.md). Docker usa exclusivamente
127.0.0.1:5434, base/usuario nest_base_test y volumen propio. No usa Supabase,
credenciales productivas ni datos de otro proyecto. Contenedor y volumen se
conservan; stop no elimina datos. El schema temporal se elimina y se consulta
pg_namespace para comprobar ausencia.

Las 21 pruebas usan tablas reales, DDL explícito y dos partitions. Incluyen
list/findByPk/findOneBy/count/exists, OR contradictorio, create sin upsert,
PK inmutable, actualización/borrado por PK y columna, soft-delete/restore,
scope ausente y hooks. Con EntityManager se prueba que una fila sin commit
es visible dentro de la transacción y no desde el repository global.
El rollback revierte creación, actualización y borrado. Servicios A/B
concurrentes no modifican la partition ajena.

Con entidad decorada real y subscriber TypeORM:
INSERT scoped ejecuta BeforeInsert y beforeInsert del subscriber.
UPDATE directo ejecuta beforeUpdate del subscriber, pero no BeforeUpdate
del listener de entidad de save. Los hooks/subscribers siguen siendo código
confiable: deben conservar autoridad. Relation writes/cascadas permanecen
rechazados por el contrato unitario; no se amplió la API para admitirlos.
Una relación leída no adquiere automáticamente una política propia.

Los límites 64 y 256 están probados en el borde permitido y por encima.
El número de combinaciones se comprueba antes de flatMap. Una prueba con
getters que fallan demuestra que 65 alternativas se rechazan antes de
inspeccionar sus valores. Las entradas originales permanecen intactas.

### Packaging y preparación de versión

El consumer independiente instala tarballs y solo importa exports públicos.
Compila ScopeWhere, ScopeContext, ScopeOperation y una especialización de
BaseService; ejecuta CrudControllerFactory con authorization y strict coverage,
consulta metadata symbol y verifica ApplicationExceptionFilter.
ESM y CJS se ejecutan en Node y Bun; declarations se compilan con TypeScript.

Los manifests siguen en 0.1.0. Recomendación: publicación coordinada 0.2.0.
Cambio exacto pendiente de release en packages/http-core/package.json:
peer @nest-base/core de >=0.1.0 <0.2.0 a >=0.2.0 <0.3.0, junto al versionado
de ambos paquetes y actualización coordinada de las expectativas de auditoría
y resolución/lock del consumidor raíz. No se afirma que 0.2.0 ya esté publicable
con los metadatos actuales. El cambio de scripts no alteró dependencias;
bun install --frozen-lockfile pasó y bun.lock permanece intacto.

### Límites y warnings restantes

- Validación ejecutada en Windows; CI/Linux no se ejecutó. El aislamiento de
  paths no depende de OneDrive; no se afirma evidencia de ejecución Linux.
- Git avisó normalización LF/CRLF. Los logs de errores inducidos por las pruebas
  de cleanup son esperados, no fallos omitidos.
- Yarn no está instalado; se verificaron los gestores disponibles, Bun/npm/pnpm.
  No hubo tests marcados como skipped por Bun.
- Scope sigue limitado a igualdades de columnas raíz. No autoriza filas
  relacionadas ni cambios de autoridad mediante cascadas.
- Los 120 s de promoción siguen siendo sensibles a carga/red; se conservan
  como gate, sin prometer rendimiento idéntico en otras máquinas.
- .atl/ preexistente permanece intacto y fuera de los commits.
