# Framework boundaries

This document is the authoritative Phase 2 boundary contract. It changes
documentation and static dependency rules only; it does not move, extract, or
rewrite runtime code.

## Ownership matrix

| Layer                              | Owned components                                                                                                                                     | Boundary statement                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeORM-aware persistence core     | `BaseService`, `PaginatedResponse`, `MutationOptions`, `QueryStringParser`, `QuerySchema`                                                            | Reusable CRUD and query contracts built on TypeORM repository and metadata semantics. This is intentionally persistence-aware, not ORM-neutral.       |
| Transport/infrastructure adapters  | `CrudControllerFactory`, Nest/Fastify HTTP concerns, response and exception mapping, auth/context propagation, Swagger, outbound HTTP, logging       | Translate external protocols and infrastructure concerns into core contracts. Adapters do not own application policy.                                 |
| Application composition and policy | `src/modules/`, entities, migrations, `src/config/`, `app.module.ts`, workflows, authentication, notifications, and project-specific health behavior | Compose the application, define business policy, and own concrete deployment choices. These areas are not reusable framework capabilities by default. |

Every listed area has one owner. Code under `src/common/` is not core by
default: a new shared component remains application-owned or is marked for
review until its reusable contract can be justified.

## Dependency rules

The normal direction is:

```text
application -> adapters -> TypeORM-aware core
                         -> Repository / EntityManager / TypeORM metadata
```

Application code may use core contracts directly when no adapter is needed.
Core code may import TypeORM, core contracts, Node standard APIs, and the
narrow Nest exception types required by its current error contract. Core code
must not import:

- Nest controllers or modules, Fastify/platform APIs, or Swagger;
- application modules, entities, migrations, concrete environment/database
  configuration, or project policy;
- authentication, notification, outbound HTTP, logging, or other adapter
  concerns.

Adapters may consume core contracts, but must remain independent of application
workflows and must not make application policy decisions. The scoped ESLint
rules in `eslint.config.mjs` enforce the highest-risk core import prohibitions.
The remaining boundary is verified through the import audit below: inspect
adapter imports under `src/common/controller/`, `src/common/http/`,
`src/common/guards/`, and related infrastructure for direct imports of
application modules, configuration, notification, migration, or policy code.
This check is explicit rather than inferred from the core rules.

### Known baseline exception

`BaseService -> RequestContext -> JwtPayload` is an existing transitive
application/auth coupling required to preserve automatic audit stamping. It is
recorded as provisional debt, not treated as proof that the core is dependency
clean, and is not refactored in this phase.

## Promotion checklist

A candidate may be promoted into reusable core only when all of the following
evidence is recorded:

- its public inputs, outputs, and failure contract are documented;
- every import is on the allowed core dependency list;
- transaction participation and failure/rollback semantics are explicit;
- focused tests cover the public contract;
- at least two real consumers or a second adapter use it.

One consumer without a second adapter is insufficient. The candidate remains
provisional and application-owned until the independent reuse evidence exists.

## Preserved behavior and non-goals

Phase 2 preserves `BaseService` pagination, query filtering, transaction
manager participation, validation/error behavior, generated-column protection,
and audit stamping. Existing consumers and tests remain authoritative.

The following are explicitly outside reusable-framework claims:

- login and authentication policy;
- notification delivery and scheduling;
- migrations and concrete database/environment configuration;
- project-specific workflows, policies, and health behavior.

There is no package extraction, source movement, runtime behavior change,
facade, or coupling-removal refactor in this phase. Future extraction must
first satisfy the promotion checklist.

## Verification checklist and evidence

| Check                 | Observable evidence                                                                                                               | Result                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Classification        | Review this matrix; every listed area has exactly one owner and the core is labeled TypeORM-aware.                                | Pass: matrix reviewed                              |
| Ambiguous shared code | Require a reusable contract before classifying new `src/common/` code as core.                                                    | Pass: policy is explicit                           |
| Valid dependency      | A core consumer imports TypeORM/core contracts; an adapter consumes a core contract without application policy.                   | Pass: import audit reviewed                        |
| Forbidden dependency  | A representative core import from an application module is rejected by scoped ESLint rules.                                       | Pass: targeted stdin probe rejected the import     |
| Promotion gate        | Review contract, imports, semantics, focused tests, and two-consumer/second-adapter evidence.                                     | Pass: all five gates are documented                |
| Existing behavior     | Run the existing BaseService suite and full quality commands; do not invent runtime tests for this documentation-only phase.      | Pass: 54 tests, typecheck, build, and format check |
| Static rules          | Run the focused architecture test for forbidden and permitted imports; it verifies ESLint configuration without runtime behavior. | Pass: 2 tests, 6 assertions                        |
| Phase scope           | Inspect `git diff --name-status`; documentation, ESLint rules, and focused static verification are the only change outputs.       | Pass: no source or runtime files changed           |

Verification must report the `RequestContext` coupling separately as baseline
debt. It must not claim transaction-manager coverage beyond the existing
`test/common/services/base.service.spec.ts` evidence.

## Rollback boundary

Revert the documentation and ESLint configuration changes, or supersede this
contract with a reviewed replacement. No application runtime, data, or
migration restoration is required.
