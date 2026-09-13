# Scope y metadata de autorización — siguiente versión

Estado: implementación local, sin publicación. Los paquetes publicados consultados
son core 0.1.0 y http-core 0.1.0. El checkout local contiene trabajo adicional;
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
No equivalen a una integración contra un servidor PostgreSQL ni prueban rollback
o locks reales. Esa integración debe añadirse al gate de adopción del consumidor.

No se aceptan como columnas de scope las versiones, fechas automáticas de actualización/borrado ni columnas mapeadas como relaciones. TypeORM puede modificarlas implícitamente; deben usarse columnas raíz estables de autoridad.
