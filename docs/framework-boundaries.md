# Framework boundaries and core readiness

This document is the authoritative source-owned boundary contract. It changes
documentation and static readiness evidence only; it does not move, extract,
build, publish, or rewrite runtime code.

## Future core export manifest

The following is the exact manifest for a future package. It is a readiness
fixture, not a package implementation. Each name has one canonical source
declaration, verified by `test/architecture/core-readiness.spec.ts`.

| Boundary        | Names                                                                                                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`             | `BaseService`, `PaginatedResponse<T>`, `MutationOptions`, `ApplicationException`, `ApplicationError`, `ApplicationErrorCategory`, `Principal`, `RequestContext`, `RequestContextStore`, `QuerySchema`, `QueryParserOptions`, `ParsedListQuery`, `QueryStringParser`, `DEFAULT_PARSER_OPTIONS` |
| `./services`    | `BaseService`, `PaginatedResponse<T>`, `MutationOptions`                                                                                                                                                                                                                                      |
| `./query`       | `QuerySchema`, `QueryParserOptions`, `ParsedListQuery`, `QueryStringParser`, `DEFAULT_PARSER_OPTIONS`                                                                                                                                                                                         |
| `./application` | `ApplicationException`, `ApplicationError`, `ApplicationErrorCategory`, `Principal`                                                                                                                                                                                                           |
| `./context`     | `RequestContext`, `RequestContextStore`                                                                                                                                                                                                                                                       |

`CrudResult` and `PaginatedResult` are legacy aliases and are not part of the
canonical surface. The machine-readable fixture records the source mapping
without creating `packages/core` or any package artifact.

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
The future core surface may import TypeORM, core contracts, and Node standard
APIs. It must not import any `@nestjs/*` module directly. HTTP adapters remain
outside the core surface and may use Nest/Fastify transport APIs while they
translate external requests into core contracts. Core code must not import:

- Nest controllers or modules, Fastify/platform APIs, or Swagger;
- application modules, entities, migrations, concrete environment/database
  configuration, or project policy;
- authentication, notification, outbound HTTP, logging, or other adapter
  concerns.

Readiness assertions intentionally reject all direct `@nestjs/*` imports from
the future core surface, in addition to Fastify, Swagger, JWT/auth adapters,
RxJS, Winston/logging, `pg`, `class-validator`, `nodemailer`, application
modules, configuration, entities, migrations, and source-path/package imports.
This list is intentionally conservative: the future package must not inherit
HTTP adapter or application wiring by accident.

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

WU2 readiness hardening preserves the WU1 `BaseService` pagination, query
filtering, transaction manager participation, validation/error behavior,
generated-column protection, and audit stamping. Existing consumers and tests
remain authoritative; this work adds only source-owned evidence and
documentation.

The following are explicitly outside reusable-framework claims:

- login and authentication policy;
- notification delivery and scheduling;
- migrations and concrete database/environment configuration;
- project-specific workflows, policies, and health behavior.

The reusable core is published as `@nest-base/core`, and the NestJS transport
adapter is published as `@nest-base/http-core`. Future adapters such as
`@nest-base/http-fastify` and `@nest-base/http-express` must remain separate
packages and satisfy the promotion checklist before publication. This contract
does not cover login, notification, or WebSockets work.

## Verification checklist and evidence

### WU3 readiness gates

The post-module-generator readiness boundary is evaluated relative to the
committed baseline `5d3f865`. Files already committed there, including the
module-generator implementation and `packages/core`/`packages/http-core`, are
not new rollout delta. The fixture classifies the remaining baseline-relative
paths through exact accepted, deferred, forbidden, and rollback-owned
inventories.

`bun.lock` is a known deferred package-integration mismatch: it records
`@nest-base/core@0.1.0` while the wizard registry expects
`@nest-base/core@1.0.0`. It is not rollback-owned, and its presence keeps
promotion blocked until a later package/version reconciliation unit resolves
it. This readiness unit does not change wizard behavior, package publication,
lockfile regeneration, or version reconciliation.

The final readiness gate is source-owned and package-aware. Its rollback artifact
set is limited to this document, the repository ignore rule, and the two
architecture readiness files: `.gitignore`, `docs/framework-boundaries.md`,
`test/architecture/core-readiness.fixture.ts`, and
`test/architecture/core-readiness.spec.ts`. It does not revert WU1 source
contracts, application imports, runtime behavior, database state, or unrelated
work. Additional adapter packages, login, notification, or WebSockets work is
outside this gate.

Windows promotion cleanup remains a separate follow-up boundary. Windows-safe
build-output rename/retry and residual cleanup are not changed by this
readiness fixture or its documentation.

`.vscode/` is local editor configuration and is ignored by the repository. It
is intentionally outside the shipped repository scope, not an authored
baseline or a readiness artifact. Scope and rollback validation inspect every
non-ignored tracked and untracked repository path and fail on any unexpected
path.

The supported baseline is exactly TypeORM `0.3.31` with PostgreSQL-oriented
behavior, and the current `bun.lock` resolves that exact TypeORM version. The
current environment has no live PostgreSQL availability; the
PostgreSQL-unavailable health diagnostic is retained as an expected diagnostic,
and this evidence must not claim live PostgreSQL availability.

Stable promotion is blocked: the current application is one consumer, while
the gate requires at least two real consumers or a genuine second consumer or
adapter. No second consumer is invented in this phase.

The consumer gate enumerates tracked `src/` files from eligible
consumer/adapter roots and parses actual imports plus `extends` and constructor
usage tied to `BaseService` or `CrudControllerFactory`. It excludes login,
notification, tests, and adapters outside the eligible set. The current
eligible enumeration contains only
`src/common/controller/crud-controller.factory.ts` as an adapter; its count is
repository-derived rather than authored as a literal. The separate stable
promotion block remains required because the count is below two.

| Check                 | Observable evidence                                                                                                                                                                           | Result                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Classification        | Review this matrix; every listed area has exactly one owner and the core is labeled TypeORM-aware.                                                                                            | Pass: matrix reviewed                                                   |
| Ambiguous shared code | Require a reusable contract before classifying new `src/common/` code as core.                                                                                                                | Pass: policy is explicit                                                |
| Valid dependency      | A core consumer imports TypeORM/core contracts; an adapter consumes a core contract without application policy.                                                                               | Pass: import audit reviewed                                             |
| Forbidden dependency  | A representative core import from an application module is rejected by scoped ESLint rules.                                                                                                   | Pass: targeted stdin probe rejected the import                          |
| Promotion gate        | Review contract, imports, semantics, focused tests, and two-consumer/second-adapter evidence.                                                                                                 | Pass: checklist documented; promotion blocked without a second consumer |
| WU1 focused evidence  | Run the committed WU1 contract, context, transaction, metadata, and query tests.                                                                                                              | Pass: 58 tests                                                          |
| WU2/WU3 readiness     | Run `bun test test/architecture/core-readiness.spec.ts`; inspect the exact manifest, gates, exclusions, and package-free scope.                                                               | Pass: 10 tests, 570 assertions                                          |
| Architecture          | Run both architecture specs, including the readiness fixture/spec and existing framework-boundary checks.                                                                                     | Pass: 13 tests, 618 assertions                                          |
| Full suite            | Run `bun test`; preserve the expected JWT configuration and unavailable-PostgreSQL diagnostics without claiming live database coverage.                                                       | Pass: 92 tests, 776 assertions                                          |
| Quality checks        | Run typecheck, lint, format, and `git diff --check`; no package or workspace wiring is introduced.                                                                                            | Pass: all commands pass                                                 |
| Phase scope           | Inspect complete non-ignored tracked/untracked repository status; compare every path with the explicit readiness set. `.vscode/` is ignored local editor configuration outside shipped scope. | Pass: no unexpected path; no production/package source changed          |

Verification must report the `RequestContext` coupling separately as baseline
debt. It must not claim live PostgreSQL availability or transaction-manager
coverage beyond the committed test evidence. The full-suite JWT configuration
warning and PostgreSQL-unavailable health diagnostic are expected environment
diagnostics, not failures. Rollback validation must use the same complete
worktree changed-set evidence as the scope gate, including tracked files,
untracked files, and any unexpected paths; it may remove only the four
readiness artifacts listed above. Ignored `.vscode/` content is not inspected
as a shipped change and cannot be used to satisfy the readiness scope.

## Rollback boundary

Revert only `.gitignore`, the readiness documentation, fixture, and assertion
changes, or supersede this contract with a reviewed replacement. No package,
workspace, lockfile, application runtime, data, or migration restoration is
required.
